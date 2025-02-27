
import fs from "fs";
import pathModule from "path";

import { EngineProcess } from "./engine-process.mjs";


export class Engine {
    constructor(name, path){
        this.name = name;
        this.path = path;
    }

    createProcess(onReadLine){
        return new EngineProcess(this, onReadLine);
    }
}

// extracts engines from a directory.
export function extractEngines(dir){
    const engines = [];

    fs.readdirSync(dir).forEach(file => {
        if (file.endsWith(".exe")){
            // valid!
            const engine = new Engine(file.replace(".exe", ""), pathModule.join(dir, file));
            engines.push(engine);
        }
    });

    return engines;
}
