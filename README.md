
# Requirements


# Puzzle Scout

Intended to specifically work for a niche chess variant. The puzzle scout is capable of identifying blunders in games (takes in .pgn files as input) and filters them out into interesting puzzles. It outputs a report containing all the necessary information to assemble a puzzle, but it is currently incapable of determining the exact variation the puzzle should follow (mostly because retrieving the full PV is not guaranteed and because the tree is searched asymmetrically). It also performs a verification step on puzzles, closely following a particular format used in [this project](https://github.com/Norberttony/local-hyper-chess).
