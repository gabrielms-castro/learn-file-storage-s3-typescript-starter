import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "path";

const MAX_UPLOAD_SIZE = 10 << 20

// type Thumbnail = {
//   data: ArrayBuffer;
//   mediaType: string;
// };

// const videoThumbnails: Map<string, Thumbnail> = new Map();

// export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
//   const { videoId } = req.params as { videoId?: string };
//   if (!videoId) {
//     throw new BadRequestError("Invalid video ID");
//   }

//   const video = getVideo(cfg.db, videoId);
//   if (!video) {
//     throw new NotFoundError("Couldn't find video");
//   }
  
//   const thumbnail = videoThumbnails.get(videoId);
//   if (!thumbnail) {
//     throw new NotFoundError("Thumbnail not found");
//   }

//   return new Response(thumbnail.data, {
//     headers: {
//       "Content-Type": thumbnail.mediaType,
//       "Cache-Control": "no-store",
//     },
//   });
// }


/* 
  handlerUploadThumbnail version that stores encoded base64 into the DB
*/
// export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {

//   //validate Request
//   const { videoId } = req.params as { videoId?: string };
//   if (!videoId) {
//     throw new BadRequestError("Invalid video ID");
//   }

//   const token = getBearerToken(req.headers);
//   const userID = validateJWT(token, cfg.jwtSecret);

//   console.log("uploading thumbnail for video", videoId, "by user", userID);

//   // get Video
//   const videoMetadata = getVideo(cfg.db, videoId);

//   if (!videoMetadata) {
//     throw new BadRequestError("Video not found.")
//   }

//   if (videoMetadata.userID !== userID) {
//     throw new UserForbiddenError("You do not own this video.")
//   }

//   //parse form data
//   const formData = await req.formData();
//   const file = formData.get('thumbnail');

//   if (!(file instanceof File)) {
//     throw new BadRequestError("Thumbnail file missing!");
//   }

//   if (file.size > MAX_UPLOAD_SIZE) {
//     throw new BadRequestError("Thumbnail file exceeds the maximum allowed size of 10MB");
//   }
  
//   // read and save the image file data
//   const mediaType = file.type;
//   if (!mediaType) {
//     throw new BadRequestError("Missing Content-Type for thumbnail");
//   }  
  
//   const fileData = await file.arrayBuffer();
//   if (!fileData) {
//     throw new Error("Error reading file data");
//   }

//   const base64Encoded = Buffer.from(fileData).toString('base64')
//   const base64DataURL = `data:${mediaType};base64,${base64Encoded}`

//   // videoThumbnails.set(videoMetadata.id, {
//   //   data: fileData, 
//   //   mediaType: mediaType
//   // });

//   // const thumbnailURL = `http://localhost:${cfg.port}/api/thumbnails/${videoMetadata.id}` // previous solution
//   // videoMetadata.thumbnailURL = thumbnailURL
//   videoMetadata.thumbnailURL = base64DataURL
//   updateVideo(cfg.db, videoMetadata)

//   return respondWithJSON(200, videoMetadata);
// }

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  //validate Request
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  // get Video metadata
  const videoMetadata = getVideo(cfg.db, videoId);

  if (!videoMetadata) {
    throw new BadRequestError("Video not found.")
  }

  if (videoMetadata.userID !== userID) {
    throw new UserForbiddenError("You do not own this video.")
  }

  //parse form data
  const formData = await req.formData();
  const file = formData.get('thumbnail');

  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file missing!");
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail file exceeds the maximum allowed size of 10MB");
  }
  
  // read and save the image file data
  const mediaType = file.type.split("/").slice(1);
  if (!mediaType) {
    throw new BadRequestError("Missing Content-Type for thumbnail");
  }  
  
  const fileData = await file.arrayBuffer();
  if (!fileData) {
    throw new Error("Error reading file data");
  }
  
  const videoPath = path.join(cfg.assetsRoot, `${videoId}.${mediaType}`)
  await Bun.write(videoPath, fileData)
  videoMetadata.thumbnailURL = `http://localhost:${cfg.port}/assets/${videoId}.${mediaType}`
  updateVideo(cfg.db, videoMetadata)

  return respondWithJSON(200, videoMetadata);
}
