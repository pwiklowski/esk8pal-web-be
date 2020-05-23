import { ObjectId } from "mongodb";

export default interface Ride {
  fileId: ObjectId;
  fileName: string;
  _id: ObjectId;
  metaData: MetaData;
}

export interface MetaData {
  tripTime: number;
  tripDistance: number;
  tripUsagedEnergy: number;
  maxSpped: number;
  maxCurrent: number;
}
