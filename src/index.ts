import generateIsolines from "./isolines";
import { DemSource } from "./dem-source";
import { pngs, decodeParsedImage } from "./decode-image";
import { LocalDemManager } from "./dem-manager";
import CONFIG from "./config";
import { HeightTile } from "./height-tile";

const exported = {
  generateIsolines,
  pngs,
  DemSource,
  HeightTile,
  LocalDemManager,
  decodeParsedImage,
  set workerUrl(url: string) {
    CONFIG.workerUrl = url;
  },
  get workerUrl() {
    return CONFIG.workerUrl;
  },
};
export default exported;
