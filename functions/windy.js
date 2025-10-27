/**
 * Fetches forecast data from the Windy API, finds the timestamp closest to the current time, 
 * and extracts all metric values for that single timestamp.
 * * @param {object} env - The Cloudflare Pages Environment object containing secrets.
 * @returns {Promise<object | null>} An object containing the closest forecast data, or null on failure.
 */
export async function fetchWindyData(apikey) {
    const WINDY_API_URL = "https://api.windy.com/api/point-forecast/v2";

    // --- Configuration ---
    const LAT = 40.86030;
    const LONG = -3.24586;
    const MODEL = "iconEu";
    const LEVELS = ["surface"];
    const PARAMETERS = [
        "temp", "dewpoint", "wind", "windGust", "precip", "convPrecip",
        "snowPrecip", "ptype", "lclouds", "mclouds", "hclouds", "pressure",
    ];
    // --- End Configuration ---

    const requestBody = {
        lat: LAT,
        lon: LONG,
        model: MODEL,
        parameters: PARAMETERS,
        levels: LEVELS,
        key: apikey,
    };

    try {
        // 1. Send POST request to Windy API
        const response = await fetch(WINDY_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        // 2. Check for HTTP errors
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Windy API call failed with status ${response.status}: ${errorText}`);
            return null;
        }

        const data = await response.json();

        // 3. Find the index of the closest timestamp
        const nowMs = Date.now();
        let closestIndex = -1;
        let minTimeDiff = Infinity;

        data.ts.forEach((timestamp, index) => {
            const timeDiff = Math.abs(nowMs - timestamp);
            if (timeDiff < minTimeDiff) {
                minTimeDiff = timeDiff;
                closestIndex = index;
            }
        });

        if (closestIndex === -1) {
            console.warn("Windy API returned data but no timestamps.");
            return null;
        }

        // 4. Extract all metrics for the closest index
        const closestForecast = {};

        // Loop through all properties in the returned data object (excluding 'ts' and 'units')
        for (const key in data) {
            if (Array.isArray(data[key]) && key !== 'ts') {
                // The key is a parameter array (e.g., 'temp-surface')
                closestForecast[key] = data[key][closestIndex];
            } else if (key === 'ts') {
                // Include the timestamp itself
                closestForecast.timestampMs = data[key][closestIndex];
                closestForecast.timestampUTC = new Date(data[key][closestIndex]).toISOString();
            }
        }

        // 5. Add Units for reference
        if (data.units) {
            closestForecast.units = data.units;
        }

        return parseWindyForecast(closestForecast);

    } catch (error) {
        console.error("Error fetching or processing Windy data:", error.message);
        return null;
    }
}

/**
 * Converts raw Windy API forecast data into the structure and units 
 * required by the WeatherReportData class.
 * * @param {object} windyData - The single timestamp object retrieved from the Windy API.
 * @returns {object} A plain object with fields matching the WeatherReportData class structure.
 */
function parseWindyForecast(windyData) {
    if (!windyData || !windyData['temp-surface']) {
        console.error("Invalid or missing Windy data.");
        return {};
    }

    // --- Conversion Constants ---
    const KELVIN_OFFSET = 273.15; // K to Celsius
    const PA_TO_HPA = 0.01;      // Pascals to Hectopascals
    const MPS_TO_KNOTS = 1.94384; // Meters per second to Knots

    // --- Utility Functions ---

    /** Converts u/v wind components (m/s) to speed (knots) and direction (degrees). */
    function uvToWind(u, v) {
        if (u === null || v === null) return { speed: null, direction: null };

        const speedMps = Math.sqrt(u * u + v * v);
        const speedKnots = speedMps * MPS_TO_KNOTS;

        // Calculate direction in radians (0 = East, Pi/2 = North)
        let directionRad = Math.atan2(u, v);

        // Convert to degrees (0 = North, increasing clockwise)
        let directionDeg = directionRad * (180 / Math.PI);

        // Convert to 0-360 degrees, where 0 is from North
        directionDeg = (directionDeg + 360) % 360;

        // Aviation standard reports wind direction FROM which the wind is blowing (subtract 180 and normalize)
        let directionFrom = (directionDeg + 180) % 360;

        // Round to nearest knot and 10 degrees for ATIS, but keep raw for internal calculation
        const reportDirection = Math.round(directionFrom / 10) * 10;

        return {
            speed: parseFloat(speedKnots.toFixed(1)), // Keep one decimal for internal use
            direction: reportDirection
        };
    }

    /** Converts an ISO date string to the ATIS format: HHMMZ */
    function convertToAtisTime(isoString) {
        // Example: '2025-10-27T00:00:00.000Z'
        if (!isoString) return null;

        // Extract the time part (HH:MM:SS.sssZ)
        const timePart = isoString.split('T')[1];
        if (!timePart) return null;

        // Extract HH and MM
        const hours = timePart.substring(0, 2);
        const minutes = timePart.substring(3, 5);

        return `${hours}${minutes}`;
    }

    // --- Perform Conversions and Mapping ---

    // Convert u/v components to direction and speed
    const wind = uvToWind(
        windyData['wind_u-surface'],
        windyData['wind_v-surface']
    );

    // Convert Kelvin to Celsius
    const tempC = windyData['temp-surface'] - KELVIN_OFFSET;
    const dewPointC = windyData['dewpoint-surface'] - KELVIN_OFFSET;

    // Convert Pa to hPa (QNH)
    const qnhHpa = windyData['pressure-surface'] * PA_TO_HPA;

    // Convert Gust speed m/s to Knots
    const gustKnots = windyData['gust-surface'] * MPS_TO_KNOTS;

    // Convert 3-hour precipitation (meters) to mm (0 if null/undefined)
    const precipMm = (windyData['past3hprecip-surface'] || 0) * 1000;

    const atisTime = convertToAtisTime(windyData.timestampUTC);
    const cloudsLayers = mapWindyCloudsToOctas(windyData['lclouds-surface'], windyData['mclouds-surface'], windyData['hclouds-surface'], parseFloat(qnhHpa.toFixed(1)))


    // --- Map to WeatherReportData structure ---
    const reportData = {
        // Wind
        wind_direction: wind.direction, // Already rounded to 10s of degrees
        wind_speed: Math.round(wind.speed), // Rounded to nearest knot
        gust_direction: wind.direction, // Use mean wind direction for gust direction (standard approximation)
        gust_speed: Math.round(gustKnots), // Rounded to nearest knot
        wind_vrb: null, // This will be calculated during the merge, not here

        // Atmospheric
        temperature: parseFloat(tempC.toFixed(1)),
        dew_point: parseFloat(dewPointC.toFixed(1)),
        qnh: parseFloat(qnhHpa.toFixed(1)),
        prec: precipMm > 0 ? Math.round(parseFloat(precipMm.toFixed(1))) : 0,

        // Timing (AEMET data uses 'HHMMZ' format for observationTime, Windy uses ISO)
        observationTime: atisTime,

        // --- Raw Windy Fields (Optional, for debugging) ---
        lClouds_percent: windyData['lclouds-surface'],
        mClouds_percent: windyData['mclouds-surface'],
        hClouds_percent: windyData['hclouds-surface'],
        clouds: cloudsLayers.clouds,
        clouds_short: cloudsLayers.clouds_short,
        ptype: windyData['ptype-surface'] // Precipitation Type Code
    };

    return reportData;
}

/**
 * Converts cloud percentages from Windy (Low, Medium, High) into aviation Octas 
 * and standard cloud reporting codes (FEW, SCT, BKN, OVC).
 * * @param {number} lclouds_percent - Low cloud cover percentage (0-100).
 * @param {number} mclouds_percent - Medium cloud cover percentage (0-100).
 * @param {number} hclouds_percent - High cloud cover percentage (0-100).
 * @returns {Array<string>} An array of cloud reports (e.g., ["BKN030", "OVC080"]).
 */
function mapWindyCloudsToOctas(lclouds_percent, mclouds_percent, hclouds_percent, qnh) {

    // Cloud layers are reported cumulatively, but since Windy gives layers, 
    // we convert each layer independently to Octas/Code.

    const cloudLayersShort = [];
    const cloudLayers = [];
    const altitudes = estimateCloudAltitude(qnh)

    // --- Octas Mapping Utility ---
    function percentToOctas(percent) {
        if (percent >= 88) return 8; // OVC
        if (percent >= 51) return 7; // BKN (5 to 7 octas, we use 7 for BKN)
        if (percent >= 25) return 4; // SCT (3 to 4 octas, we use 4 for SCT)
        if (percent >= 1) return 2;  // FEW (1 to 2 octas, we use 2 for FEW)
        return 0; // SKC/CLR
    }

    function octasToCodeShort(octas) {
        if (octas === 8) return "OVC";
        if (octas >= 5) return "BKN";
        if (octas >= 3) return "SCT";
        if (octas >= 1) return "FEW";
        return "SKC"; // or CLR
    }

    function octasToCode(octas) {
        if (octas === 8) return "OVERCAST";
        if (octas >= 5) return "BROKEN";
        if (octas >= 3) return "SCATTERED";
        if (octas >= 1) return "FEW";
        return "SKY CLEAR"; // or CLR
    }

    // --- Process Layers ---

    // Note: Since Windy doesn't provide cloud height (ceiling), 
    // we use placeholder heights (e.g., 3000ft for low, 8000ft for mid, 25000ft for high).
    // If your ATIS uses only one field for 'sky', you'll need a final selection step.

    // 1. Low Clouds
    const lowOctas = percentToOctas(lclouds_percent);
    if (lowOctas > 0) {
        // Use 3000ft as a placeholder altitude for low clouds
        cloudLayersShort.push(`${octasToCodeShort(lowOctas)} ${altitudes.altitudeLow}ft`);
        cloudLayers.push(`${octasToCode(lowOctas)} at ${altitudes.altitudeLow} feet`);
    }

    // 2. Medium Clouds
    const midOctas = percentToOctas(mclouds_percent);
    if (midOctas > 0) {
        // Use 8000ft as a placeholder altitude for medium clouds
        cloudLayers.push(`${octasToCode(midOctas)} at ${altitudes.altitudeMid} feet`);
        cloudLayersShort.push(`${octasToCodeShort(midOctas)} ${altitudes.altitudeMid}ft`);
    }

    // 3. High Clouds
    const highOctas = percentToOctas(hclouds_percent);
    if (highOctas > 0) {
        // Use 25000ft as a placeholder altitude for high clouds
        cloudLayers.push(`${octasToCode(highOctas)} at ${altitudes.altitudeHigh} feet`);
        cloudLayersShort.push(`${octasToCodeShort(highOctas)} ${altitudes.altitudeHigh}ft`);
    }

    // 4. Handle SKC/CLR
    if (cloudLayers.length === 0) {
        // If there is no cloud cover at any layer, report clear sky.
        // Assuming your airport is LERM (Spain), we'll use "SKC" (Sky Clear)
        cloudLayersShort.push("SKC");
        cloudLayers.push("SKY CLEAR");
    }

    return {
        clouds: cloudLayers,
        clouds_short: cloudLayersShort
    };
}

/**
 * Estimates cloud altitude based on pressure difference and a constant gradient.
 * * @param {number} qnh - The actual surface pressure (QNH) in hPa.
 * @returns {object} Estimated altitudes in feet for low, medium, and high clouds.
 */
function estimateCloudAltitude(qnh) {
    // Pressure levels for the cloud layers (in hPa)
    const P_LOW_CLOUDS = 800;
    const P_MID_CLOUDS = 600;
    const P_HIGH_CLOUDS = 400;

    // Atmospheric Pressure Gradient: 1 hPa / 27 ft, or 27 ft / 1 hPa
    const FT_PER_HPA = 27;

    /** Calculates altitude in feet and rounds to the nearest 100 ft. */
    function calculateAltitude(layerPressure) {
        if (qnh <= layerPressure) return 0; // Layer is at or below the surface

        const deltaP = qnh - layerPressure;
        const altitude = deltaP * FT_PER_HPA;

        // Round to the nearest 100 feet, which is common in aviation
        return Math.round(altitude / 100) * 100;
    }

    const altitudeLow = calculateAltitude(P_LOW_CLOUDS);
    const altitudeMid = calculateAltitude(P_MID_CLOUDS);
    const altitudeHigh = calculateAltitude(P_HIGH_CLOUDS);

    return {
        altitudeLow,
        altitudeMid,
        altitudeHigh
    };
}