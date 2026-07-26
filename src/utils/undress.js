const axios = require("axios");
const { cacheBufferMedia } = require("./cache");

const API_BASE = "https://sylvatica.my.id/api/maker/deepnude";

/**
 * input: image URL (string) OR already-downloaded Buffer.
 * Since deekuude API only accepts a `url` query param, a Buffer input
 * first gets cached locally to produce a temporary public URL, then
 * that URL is passed to the deekuude API.
 */
async function removeBgViaDeekuude(req, input, mimeType = "image/jpeg") {
  let imageUrl;

  if (Buffer.isBuffer(input)) {
    // host the uploaded buffer temporarily so deekuude API can fetch it
    imageUrl = cacheBufferMedia(req, input, mimeType, ".jpg");
  } else {
    imageUrl = input;
  }

  const apiUrl = `${API_BASE}?url=${encodeURIComponent(imageUrl)}`;

  const response = await axios.get(apiUrl, {
    responseType: "arraybuffer",
    timeout: 60000,
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  const contentType = response.headers["content-type"] || "image/png";

  if (!contentType.startsWith("image/")) {
    throw new Error("API did not return an image (deekuude failed).");
  }

  return {
    buffer: Buffer.from(response.data),
    contentType
  };
}

module.exports = { removeBgViaDeekuude };
