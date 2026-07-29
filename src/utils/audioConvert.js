const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const { ax } = require("./http");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━
// ANY AUDIO/VIDEO (URL or Buffer) -> OGG (Opus)
// ffmpeg auto-detects the input container/codec, so this
// works for mp3, mp4, m4a, wav, webm, etc. — anything ffmpeg
// can demux and pull an audio stream out of.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━
async function toOggOpus(input) {
  const tmpId = crypto.randomBytes(8).toString("hex");
  const inPath = path.join(os.tmpdir(), `${tmpId}-in`);
  const outPath = path.join(os.tmpdir(), `${tmpId}-out.ogg`);

  try {
    let inputBuffer;

    if (Buffer.isBuffer(input)) {
      inputBuffer = input;
    } else {
      const { data } = await ax.get(input, { responseType: "arraybuffer" });
      inputBuffer = Buffer.from(data);
    }

    await fs.promises.writeFile(inPath, inputBuffer);

    await new Promise((resolve, reject) => {
      const args = [
        "-i", inPath,
        "-c:a", "libopus",
        "-b:a", "96k",
        "-vbr", "on",
        "-ac", "1",
        "-ar", "48000",
        "-frame_duration", "20",
        "-application", "audio",
        "-compression_level", "10",
        "-map_metadata", "-1",
        "-vn",
        "-f", "ogg",
        "-y",
        outPath
      ];

      const proc = spawn(ffmpegPath, args);

      let stderr = "";
      proc.stderr.on("data", (d) => { stderr += d.toString(); });

      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      });
    });

    const outputBuffer = await fs.promises.readFile(outPath);
    return { buffer: outputBuffer, contentType: "audio/ogg" };
  } finally {
    fs.promises.unlink(inPath).catch(() => {});
    fs.promises.unlink(outPath).catch(() => {});
  }
}

module.exports = { toOggOpus };
