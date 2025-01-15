
const fs = require("fs");

const { Board } = require("../game/game");
const { Piece } = require("../game/piece");
const { getMoveSAN } = require("../game/san");

// splits the given string into each individual game.
// returns an array of the individual games.
function splitPGNs(pgnsString){
    const games = [];

    let globalIdx = 0;

    while (true){
        // to-do: does not handle cases where "1." might appear in the PGN headers...
        const movesIdx = pgnsString.indexOf("1.", globalIdx);
        const nextBrckt = pgnsString.indexOf("[", movesIdx);

        if (nextBrckt == -1){
            // end of file.
            games.push(pgnsString.substring(globalIdx).trim());
            return games;
        }else{
            games.push(pgnsString.substring(globalIdx, nextBrckt - 1).trim());
            globalIdx = nextBrckt - 1;
        }
    }
}

// converts a specific kind of format used by the battle-ring. In this case, LAN files are sequences
// of moves in LAN separated by line breaks.
function convertLANToPGN(lanFilePath){
    const lanFile = fs.readFileSync(lanFilePath).toString();
    const lanMoves = lanFile.split("\n");

    const board = new Board();
    let pgn = "";

    // interpret headers
    while (lanMoves.length){
        const hdr = lanMoves[0];
        if (hdr.startsWith("White: ")){
            pgn += `[White "${hdr.replace("White: ", "").trim()}]\n`;
        }else if (hdr.startsWith("Black: ")){
            pgn += `[Black "${hdr.replace("Black: ", "").trim()}"]\n`;
        }else if (hdr.startsWith("FEN: ")){
            const fen = hdr.replace("FEN: ", "").trim();
            pgn += `[FEN "${fen}"]\n`;
            board.loadFEN(fen);
        }else{
            break;
        }
        lanMoves.shift();
    }

    pgn += "\n";

    // play out each move
    let counter = board.fullmove;
    if (board.turn == Piece.black){
        pgn += `${counter++}... `;
    }
    for (const lan of lanMoves){
        const move = board.getLANMove(lan);
        if (move){
            const san = getMoveSAN(board, move);
            board.makeMove(move);

            if (board.turn == Piece.black){
                pgn += `${counter++}. ${san} `;
            }else{
                pgn += `${san} `;
            }
        }
    }

    return pgn.trim();
}

// returns a dictionary where keys are header names and values are header values.
function extractHeaders(pgn){
    const headers = {};

    let leftBracket = pgn.indexOf("[");
    while (leftBracket > -1){
        let rightBracket = pgn.indexOf("]");
        const field = pgn.substring(leftBracket, rightBracket + 1);

        let leftQuote = field.indexOf("\"") + leftBracket;
        let rightQuote = field.indexOf("\"", leftQuote + 1) + leftBracket;

        if (leftQuote > -1 && rightQuote > -1){
            let value = pgn.substring(leftQuote + 1, rightQuote).trim();
            let name = pgn.substring(leftBracket + 1, leftQuote).trim();
            headers[name] = value;
        }

        // remove header now that we've extracted it
        pgn = pgn.substring(rightBracket + 1);

        leftBracket = pgn.indexOf("[");
    }

    return headers;
}

function extractMoves(pgn){
    // remove headers
    pgn = pgn.replace(/\[.+?\]\s*/g, "");

    // remove any comments
    pgn = pgn.replace(/\{.+?\}\s*/g, "");

    // remove full move counters
    pgn = pgn.replace(/[0-9]+[\.]+/g, "");

    // add a space before and after parentheses
    pgn = pgn.replace(/\(/g, " ( ").replace(/\)/g, " ) ");

    // make sure there is one space between each move
    pgn = pgn.replace(/\s+/g, " ");
    pgn = pgn.trim();

    return pgn;
}

module.exports = { splitPGNs, extractHeaders, extractMoves, convertLANToPGN };
