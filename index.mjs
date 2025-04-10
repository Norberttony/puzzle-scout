
import fs from "fs";
import pathModule from "path";
import { cpus } from "os";

import * as PGN_Handler from "./modules/pgn-file-reader.mjs";
import { Board } from "./modules/game/game.mjs";
import { ProgressBar } from "./modules/progress-bar.mjs";
import { log } from "./modules/logger.mjs";
import { config } from "./modules/config.mjs";
import { TaskManager } from "./modules/task-manager.mjs";


{
    const puzzlePotential = openJSONFile(config["results-path"]);
    const games = fetchGames();

    const bar = new ProgressBar("Processing games...");

    const threads = 1; // cpus().length / 2
    const tm = new TaskManager("./modules/puzzle-generator.mjs", threads, { engineDir: "./engine" });

    let gamesProcessed = 0;
    let totalGames = games.length;

    for (const pgn of games){
        tm.doTask(pgn)
            .then((puzzles) => {
                gamesProcessed++;
                bar.progress = gamesProcessed / totalGames;

                // remove from games list
                games.splice(games.indexOf(pgn), 1);
                fs.writeFileSync("./data/games.json", JSON.stringify(games));

                puzzlePotential.push(...puzzles);
                fs.writeFileSync(config["results-path"], JSON.stringify(puzzlePotential));

                if (gamesProcessed == totalGames)
                    tm.terminate();
            });
    }
}


// reads the games directory, extracts all PGNs
function fetchGames(){
    // read in PGNs currently stored in games.json
    const games = openJSONFile("./data/games.json");

    const gamesPath = "./games";
    const gamesScannedPath = "./games-scanned";

    const dir = fs.readdirSync("./games");
    for (const name of dir){
        const path = pathModule.join(gamesPath, name);
        if (name.endsWith(".pgn") && !fs.lstatSync(path).isDirectory()){
            const pgns = PGN_Handler.splitPGNs(fs.readFileSync(path).toString());
            for (const pgn of pgns){
                games.push(pgn);
            }
            console.log(`Extracted ${pgns.length} games from ${name}`);
            fs.renameSync(path, pathModule.join(gamesScannedPath, name));
        }
    }

    // save games
    fs.writeFileSync("./data/games.json", JSON.stringify(games));

    return games;
}

function prepareCmdsFile(){
    let cmds = ``;
    let timeout = 20;
    let p = 0;
    for (const pgn of gamePGNs){
        const board = new Board();

        // extract all move objects to play on the board
        const moveStrings = PGN_Handler.extractMoves(pgn);
        const moves = [];
        for (const m of moveStrings.split(" ")){
            const move = board.getMoveOfSAN(m);
            if (move){
                moves.push(move);
                board.makeMove(move);
                move.san = m;
                timeout--;
                if (timeout == 0){
                    timeout = 10;
                    cmds += `
clear hash
position fen ${board.getFEN()}
go movetime 10000
`;
                    p++;
                }
            }
        }
    }
    console.log(`Gathered ${p} positions`);
    fs.writeFileSync("./cmds.txt", cmds);
}

function openJSONFile(path){
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path).toString()) : [];
}
