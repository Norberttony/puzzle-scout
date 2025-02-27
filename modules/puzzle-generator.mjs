
import { parentPort, workerData } from "worker_threads";

import { log } from "./logger.mjs";
import { Board } from "../game/game.mjs";
import * as PGN_Handler from "./pgn-file-reader.mjs";
import { analyzeGame, findBlunders, getMovesFromPV, verifyCandidate, formatPuzzle } from "./engine-helpers.mjs";
import { config } from "./config.mjs";
import { extractEngines } from "./engine.mjs";


const shallowPly = config["shallow-search-depth-ply"];
const extraPly = config["confirm-search-additional-ply"];
const blunderMag = config["blunder-magnitude"];
const winnerMax = config["winner-max"];

const engineWrapper = extractEngines(workerData.engineDir)[0];


parentPort.on("message", async (pgn) => {
    parentPort.postMessage(await generatePuzzles(pgn, engineWrapper));
});


async function generatePuzzles(pgn, engineWrapper){

    log(`Starting engine ${engineWrapper.name}...`);

    const engine = engineWrapper.createProcess();

    await engine.prompt("uciready", "uciok");
    await engine.prompt("isready", "readyok");

    log("Engine ready to go.");

    const headers = PGN_Handler.extractHeaders(pgn);
    const board = new Board();
    
    if (headers.FEN)
        board.loadFEN(headers.FEN);

    log("PGN Headers extracted");
    log(`Game identifier is ${headers.Site}`);

    // extract all move objects to play on the board
    const moveStrings = PGN_Handler.extractMoves(pgn);
    const moves = [];
    for (const m of moveStrings.split(" ")){
        const move = board.getMoveOfSAN(m);
        if (move){
            moves.push(move);
            board.makeMove(move);
            move.san = m;
        }
    }

    log(`Total of ${moves.length} moves extracted`);

    for (let i = moves.length - 1; i >= 0; i--)
        board.unmakeMove(moves[i]);

    log("Analyzing game...");

    const analysis = await analyzeGame(board.getFEN(), moves, engine, shallowPly);

    log("Searching for blunders...");

    // convert the list of analyses of each intermediate position into a list of blunders.
    const blunders = await findBlunders(analysis, engine, blunderMag, shallowPly + extraPly, winnerMax);

    log(`${blunders.length} blunders have been found. Beginning verification phase...`);

    // convert a list of blunders into a list of potential puzzles.
    const puzzles = [];
    for (const blunder of blunders){
        board.loadFEN(blunder.fen);
        board.makeMove(blunder.move);
        const afterBlunderFEN = board.getFEN();

        log(`Looking at puzzle: ${blunder.val} ${blunder.pv}`);

        // extract PV into actual move objects
        const candidate = getMovesFromPV(afterBlunderFEN, blunder.pv);

        const puzzle = await verifyCandidate(afterBlunderFEN, candidate, engine, blunder.val, config["verify-search-ply"], config["verify-delta"]);

        if (!puzzle)
            continue;

        const formatted = formatPuzzle(afterBlunderFEN, puzzle, blunder.val, blunder.color);
        formatted.beforeBlunderFEN = blunder.fen;
        puzzles.push(formatted);
    }

    log(`Generated ${puzzles.length} additional puzzles`);

    engine.stop();

    return puzzles;
}
