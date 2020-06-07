import { ObjectId } from "mongodb";

export default interface Ride {
  ownerId: string;
  fileId: ObjectId;
  fileName: string;
  _id: ObjectId;
  metaData: MetaData;
}

export interface MetaData {
  start: number;
  tripTime: number;
  tripDistance: number;
  tripUsedEnergy: number;
  maxSpped: number;
  maxCurrent: number;
}
