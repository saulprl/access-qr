const http = require("http");
const Jimp = require("jimp");
const jsQR = require("jsqr");
const Gpio = require("onoff").Gpio;
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config({ path: "./.env.local" });

const door = new Gpio(18, "out");

// Replace with your camera's IP address
const cameraIp = process.env.CAMERA_IP;
const API_URL = process.env.ACCESS_API_URL;
const roomName = process.env.ROOM_NAME;
const roomBuilding = process.env.ROOM_BUILDING;
const room = process.env.ROOM;
const credentials = process.env.CREDENTIALS;

let lastToken = "";
let canMakeRequest = true;
let request;
let requestTimeout;

const retryInterval = 5000;

// HTTP request options
const options = {
  host: cameraIp,
  path: "/img/video.mjpeg", // Adjust the path as needed
  headers: {
    Authorization: "Basic " + Buffer.from(credentials).toString("base64"), // Replace with your camera's credentials
  },
};

const connectToCamera = () => {
  console.log("Attempting connection");
  // Create an HTTP request to the camera's MJPEG video feed
  request = http.get(options, (response) => {
    // Create a buffer to store the video data
    let videoBuffer = Buffer.from([]);
    console.log("Connected to camera");
    const frameProcessingInterval = 800;

    let canProcessFrame = true;
    let responseTimeout;

    response.on("data", (data) => {
      // Append data to the video buffer
      videoBuffer = Buffer.concat([videoBuffer, data]);

      // Find the start and end of each frame
      let startIndex = 0;
      let endIndex = 0;
      while (startIndex < videoBuffer.length) {
        // Find the start marker (0xFFD8)
        startIndex = videoBuffer.indexOf(Buffer.from([0xff, 0xd8]), startIndex);
        if (startIndex === -1) {
          // Start marker not found, exit the loop
          break;
        }

        // Find the end marker (0xFFD9)
        endIndex = videoBuffer.indexOf(Buffer.from([0xff, 0xd9]), startIndex);
        if (endIndex === -1) {
          // End marker not found, exit the loop
          break;
        }

        // Extract the frame between start and end markers
        const frameData = videoBuffer.slice(startIndex, endIndex + 2); // Include the end marker
        startIndex = endIndex + 2; // Move to the next frame

        // Process the frame (e.g., decode using Jimp and recognize QR codes)
        if (canProcessFrame) {
          canProcessFrame = false;

          processFrame(frameData);

          setTimeout(() => {
            canProcessFrame = true;
          }, frameProcessingInterval);
        }

        if (responseTimeout) {
          clearTimeout(responseTimeout);
        }

        responseTimeout = setTimeout(handleRequestTimeout, retryInterval);
      }

      // Remove processed data from the video buffer
      videoBuffer = videoBuffer.slice(endIndex + 2);
    });

    response.on("end", () => {
      console.error(
        `Connection to the camera was lost. Retrying in ${
          retryInterval / 1000
        } seconds...`
      );

      setTimeout(connectToCamera, retryInterval);
    });

    responseTimeout = setTimeout(handleRequestTimeout, retryInterval);
  });

  request.on("error", (error) => {
    console.error("Error connecting to the camera: ", error);
    console.log(`Retrying in ${retryInterval / 1000} seconds...`);

    if (requestTimeout) {
      clearTimeout(requestTimeout);
    }
    requestTimeout = setTimeout(connectToCamera, retryInterval);
  });
};

async function processFrame(frameData) {
  // Convert the frame to a Jimp image
  Jimp.read(frameData, (err, image) => {
    if (err) {
      console.error("Error reading frame:", err);
      return;
    }
    // Decode the frame using jsQR to recognize QR codes
    const pixels = new Uint8ClampedArray(image.bitmap.data.buffer);
    const decoded = jsQR(pixels, image.bitmap.width, image.bitmap.height);

    // Display and process the frame as needed
    if (decoded && canMakeRequest) {
      const { data } = decoded;
      makeRequest(data);
    } else if (!canMakeRequest) {
      console.log("Skipping request");
    }
  });
}

/**
 * Makes a request to a specific API endpoint which expects a JWT string. If the request is successful and the user is granted access, output a signal through the specified PIN (GPIO 18).
 */
const makeRequest = async function (token) {
  if (lastToken === token) {
    console.log("makeRequest -> token already used");
    return;
  }

  lastToken = token;
  setTimeout(() => {
    lastToken = "";
  }, 10000);

  canMakeRequest = false;
  setTimeout(() => {
    canMakeRequest = true;
  }, 2000);

  console.log("makeRequest -> started");

  try {
    // Makes the post request to the validation API
    const res = await axios.post(`${API_URL}/api/access/qr-token`, {
      token,
      roomName,
      roomBuilding,
      room,
    });

    const data = res.data;
    // console.log(data);
    if (data["grantedAccess"] === true) {
      console.log("on -> grantedAccess");
      door.write(1).then((_) => setTimeout(() => door.write(0), 2000));
    }
  } catch (error) {
    console.log("makeRequest -> error: ", error);
  }
};

const handleRequestTimeout = () => {
  console.error(
    `Response from the camera is inactive. Retrying in ${
      retryInterval / 1000
    } seconds...`
  );

  if (request) {
    console.log("destroying request");
    request.destroy();

    setTimeout(connectToCamera, retryInterval);
  }
};

connectToCamera();

process.on("SIGINT", (_) => {
  door.unexport();
  process.exit();
});
