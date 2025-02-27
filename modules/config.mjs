
import fs from "fs";

export const config = JSON.parse(fs.readFileSync("./data/config.json").toString());
