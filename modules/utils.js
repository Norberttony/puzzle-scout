
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";


// returns true if the current file can be executed, and returns false otherwise.
// Courtesy of
// https://stackoverflow.com/questions/16258578/how-do-i-check-if-a-file-is-executable-in-node-js
export async function isExecutable(pathToFile){
    const stats = await fs.stat(pathToFile);

    if (!stats.isFile())
        return false;

    if (os.platform() == "win32"){
        // on Windows, executables are determined by file extensions
        return path.extname(pathToFile).toLowerCase() == ".exe";
    }else{
        // on Unix-like systems, a bit is used to determine if the file is executable
        try {
            await fs.access(pathToFile, fs.constants.X_OK);
        }
        catch(err){
            return false;
        }
        return true;
    }
}
