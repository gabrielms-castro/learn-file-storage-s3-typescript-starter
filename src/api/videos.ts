import { rm } from "fs/promises"
import path from "path";
import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import { type BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo, type Video } from "../db/videos";
import { mediaTypeToExtension } from "./assets";
import { generatePresignedURL, uploadVideoToS3 } from "../s3";


const MAX_VIDEO_UPLOAD_SIZE = 1 << 30

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  // 1) extract video ID from URL path parameters
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID")
  }

  // 2) Authenticate user to get User ID
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);
  
  // 3) Get video metadata and check if the user is the owner
  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new BadRequestError("Video not found.")
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError("You do not own this video.")
  }

  // Parse the uploaded video
  const formData = await req.formData();
  const file = formData.get("video") //load the file in memory
  if (!(file instanceof File)) {
    throw new BadRequestError("Video missing");
  }

  // validate maximum file upload size
  if (file.size > MAX_VIDEO_UPLOAD_SIZE) {
    throw new BadRequestError("Video exceeds the maximum allowed size of 1 GB");
  }

  
  // ensure it's a MP4 video
  const mediaType = file.type
  if(!mediaType) {
    throw new BadRequestError("Missing Content-Type for video")
  }
  if (mediaType !== "video/mp4") {
    throw new BadRequestError("File type not supported. Only MP4 allowed.")
  }
  const fileExtension = mediaTypeToExtension(mediaType)
  
  // save uploaded file to a temporary fileon disk
  const tempVideoPath = path.join("/tmp", `${videoId}.mp4`)
  await Bun.write(tempVideoPath, file);

  // get aspect ratio
  const aspectRatio = await getVideoAspectRatio(tempVideoPath)
  
  // faststart
  const fastStartVideoPath = await processVideoForFastStart(tempVideoPath)
  
  // put file into s3
  let key = `${aspectRatio}/${videoId}${fileExtension}`
  await uploadVideoToS3(cfg, key, fastStartVideoPath, mediaType)

  // updating video record on DB with the S3 object URL
  // const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`
  const videoURL = key
  video.videoURL = videoURL
  updateVideo(cfg.db, video);
  
  
  // ensuring that the temp files are removed
  await Promise.all([rm(tempVideoPath, { force: true })])
  await Promise.all([rm(fastStartVideoPath, { force: true })])
  
  const signed = await dbVideoToSignedVideo(cfg, video);
  return respondWithJSON(200, signed)
}

export async function getVideoAspectRatio(filepath: string) {
  const subprocess = Bun.spawn(
    ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", filepath], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutText = await new Response(subprocess.stdout).text();
  const stderrText = await new Response(subprocess.stderr).text();
  
  const error = await subprocess.exited
  if (error !== 0) {
    throw new Error(`ffprobe error: ${stderrText}`)
  }

  const output = JSON.parse(stdoutText)
  if (
    !output.streams ||
    output.streams.length === 0
  ) {
    throw new Error("No video streams found");
  }  

  const {width, height} = output.streams[0]
  
  return width === Math.floor(16 * (height / 9))
    ? "landscape"
    : height === Math.floor(16 * (width / 9))
      ? "portrait"
      : "other";
}

async function processVideoForFastStart(inputFilePath: string) {
  const outputFilePath = inputFilePath + ".processed"
  const subproc = Bun.spawn(
    ["ffmpeg", "-i", inputFilePath, "-movflags", "faststart", "-map_metadata", "0", "-codec", "copy", "-f", "mp4", outputFilePath], 
    { stderr: "pipe" }
  );

  const stderrText = await new Response(subproc.stderr).text();
  const exitCode = await subproc.exited
  if (exitCode !== 0) {
    throw new Error(`ffmpeg error: ${stderrText}`)
  }
  
  return outputFilePath
}



export async function dbVideoToSignedVideo(cfg: ApiConfig, video: Video) {
  if (!video.videoURL) {
    return video
  }
  
  const key = video.videoURL as string
  video.videoURL = await generatePresignedURL(cfg, key, 5 * 60)
  return video;
}