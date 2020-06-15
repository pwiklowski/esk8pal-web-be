import { ObjectId } from "mongodb";

export default interface Ride {
  ownerId: string;
  fileId: ObjectId;
  fileName: string;
  _id: ObjectId;
  metaData: MetaData;
  uploaded: Date;
  deviceId: string;
}

export interface MetaData {
  start: number;
  tripTime: number;
  tripDistance: number;
  tripUsedEnergy: number;
  maxSpeed: number;
  maxCurrent: number;
  averageSpeed: number;
  averageSpeedWhenMoving: number;
}
