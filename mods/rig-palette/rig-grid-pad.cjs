// An empty owned viewer tile keeps an incomplete grid rectangular. It starts no child process.
process.stdout.write("\x1b]2;Empty tile\x07\x1b[?25l\x1b[2mEmpty tile: keeps the grid even.\x1b[0m\r\n");
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on("data", () => {});
process.stdin.resume();
setInterval(() => {}, 2147483647);
