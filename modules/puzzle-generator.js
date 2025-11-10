
import { parentPort, workerData } from "node:worker_threads";
import fs from "node:fs";
import pathModule from "node:path";

import { log } from "./logger.js";
import { Board } from "hyper-chess-board";
import * as PGN_Handler from "hyper-chess-board/pgn";

import { findBlunders, Analysis } from "./game-analysis.js";
import { generatePuzzleCandidates, verifySolution, formatPuzzle } from "./puzzle-helpers.js";

import { config } from "./config.js";
import { extractEngines, EngineProcess } from "./engine-process.js";


const shallowPly = config["shallow-search-depth-ply"];
const blunderMag = config["blunder-magnitude"];

const enginePath = (await extractEngines(workerData.data.engineDir))[0];


parentPort.on("message", async ({ pgn, id }) => {
    parentPort.postMessage(await generatePuzzles(pgn, id, enginePath));
});


// starts an engine and ensures it is UCI-compliant and ready.
// the returned engine must be closed using the engine.stop() method.
async function prepareEngineProcess(enginePath){
    log(`Starting engine "${enginePath}"...`);
    const engine = new EngineProcess(enginePath);
    await engine.prompt("uciready", "uciok");
    await engine.prompt("isready", "readyok");
    log("Engine ready to go.");
    return engine;
}

async function generatePuzzles(pgn, gameId, enginePath){
    const debugDir = pathModule.join(".", "debug");
    const analysisPath = pathModule.join(debugDir, `${gameId}-analysis.json`);

    // prepare engine
    const engine = await prepareEngineProcess(enginePath);

    // extract PGN headers
    const headers = PGN_Handler.extractHeaders(pgn);
    const board = new Board();
    
    if (headers.FEN)
        board.loadFEN(headers.FEN);

    log("PGN Headers extracted");
    log(`Game identifier is ${headers.Site}`);

    // analyze each position
    log("Analyzing game...");
    const analysis = new Analysis(pgn, engine, analysisPath);
    while (analysis.canAnalyze())
        await analysis.once(1000);

    // identify blunders from analysis
    log("Searching for blunders...");
    const blunders = findBlunders(analysis.getAnalysis(), blunderMag);
    log(`${blunders.length} blunders have been found.`);
    fs.writeFileSync(`./debug/${gameId}-blunders.json`, JSON.stringify(blunders));

    const candidates = generatePuzzleCandidates(blunders, config["winner-max"]);
    fs.writeFileSync(`./debug/${gameId}-candidates.json`, JSON.stringify(candidates));

    // convert a list of candidates into a list of potential puzzles.
    const puzzles = [];
    for (const candidate of candidates){
        board.loadFEN(candidate.fenBeforeMistake);
        board.makeMove(candidate.leadingMistake);
        const afterBlunderFEN = board.getFEN();

        log(`Verifying candidate: ${JSON.stringify(candidate)}`);

        const puzzle = await verifySolution(candidate, engine, config["verify-search-ply"], config["verify-delta"]);

        log(`After verification: ${JSON.stringify(puzzle)}`);

        if (!puzzle)
            continue;

        const formatted = formatPuzzle(afterBlunderFEN, puzzle, candidate.scoreAfterMistake, board.turn);
        
        formatted.beforeBlunderFEN = candidate.fenBeforeMistake;
        formatted.fromGame = pgn;

        puzzles.push(formatted);
    }

    log(`Generated ${puzzles.length} additional puzzles`);
    fs.writeFileSync(`./debug/${gameId}-puzzles.json`, JSON.stringify(puzzles));

    engine.stop();

    return puzzles;
}
