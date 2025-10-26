/**
 * Converts Spanish cardinal direction text (N, S, O, E) to magnetic degrees (for wind data).
 * * @param {string} direction - N, S, O, E, NE, SO, etc.
 * @returns {number} Magnetic degrees (0-360).
 */
function directionToDegrees(direction) {
    // Trim whitespace and remove any trailing period before mapping
    const cleanedDirection = direction.toUpperCase().trim().replace('.', '');

    const map = {
        // Primary
        'N': 360,    // Norte (North)
        'E': 90,   // Este (East)
        'S': 180,  // Sur (South)
        'O': 270,  // Oeste (West)

        // Secondary
        'NE': 45,  // Nordeste (Northeast)
        'SE': 135, // Sureste (Southeast)
        'SO': 225, // Suroeste (Southwest)
        'NO': 315, // Noroeste (Northwest)

        // Tertiary (Note: Tertiary names can vary, these are standard angles)
        'NNE': 22, 'ENE': 67,
        'ESE': 112, 'SSE': 157,
        'SSO': 202, 'OSO': 247, // Using SSO/OSO for Suroeste
        'ONO': 292, 'NNO': 337, // Using ONO/NNO for Noroeste

        'VRB': 0   // Variable/Calm is often mapped to 0 degrees
    };

    // Return the mapped degree, defaulting to 0 for unknown/Calm cases
    return map[cleanedDirection] !== undefined ? map[cleanedDirection] : 0;
}

// ----------------------------------------------------------------------
// --- UPDATED parseCleanConditions (to call the new function) ---

/**
 * Parses the clean, fixed-format text output to retrieve weather parameters.
 * (This function is updated to use the Spanish directionToDegrees.)
 */
function parseCleanConditions(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        return { error: "Invalid input text." };
    }

    // Regular expressions remain the same
    const timeRegex = /Actualizado:\s*(\d{2}\/\d{2}\/\d{4})\s*(\d{2}:\d{2}:\d{2})/;
    const tempRegex = /Temp\.:\s*([\d.]+)\s*°C/;
    const windRegex = /Viento:\s*([\d.]+)\s*km\/h\s*del\s*([A-Z]+)\.?/i; // Captures N, S, O, etc.
    const qnhRegex = /QNH:\s*(\d+)\s*hPa/;
    const sunTimesRegex = /Orto:\s*(\d{2}:\d{2})\.\s*[\S]*Ocaso:\s*(\d{2}:\d{2})/;

    const results = {};

    // 1. Observation Time (Parsing logic remains the same)
    const timeMatch = rawText.match(timeRegex);
    if (timeMatch) {
        const [day, month, year] = timeMatch[1].split('/');
        const time = timeMatch[2];
        // Note: Time is in CET. Using a standard format.
        results.observationTime_raw = `${year}-${month}-${day}T${time}`;
        results.observationTime_atis = convertToAtisTime(results.observationTime_raw)
    } else {
        results.observationTime_raw = null;
    }

    // 2. Temperature
    const tempMatch = rawText.match(tempRegex);
    results.temperature_c = tempMatch ? parseFloat(tempMatch[1]) : null;

    // 3. Wind (Key change: using the Spanish direction parser)
    const windMatch = rawText.match(windRegex);
    if (windMatch) {
        const speed_kmh = parseFloat(windMatch[1]);
        const direction_text = windMatch[2].toUpperCase();

        results.wind_speed_knots = convertKmhToKnots(speed_kmh);
        results.wind_direction_text = direction_text;

        // *** CALLING THE SPANISH DIRECTION FUNCTION ***
        results.wind_direction_degrees = directionToDegrees(direction_text);
    } else {
        // Default to calm/variable
        results.wind_speed_knots = null;
        results.wind_direction_degrees = null;
    }

    // 4. QNH
    const qnhMatch = rawText.match(qnhRegex);
    results.qnh_hpa = qnhMatch ? parseInt(qnhMatch[1]) : null;

    // 5. Sunrise and Sunset
    const sunMatch = rawText.match(sunTimesRegex);
    if (sunMatch) {
        results.sunrise = sunMatch[1];
        results.sunset = sunMatch[2];
    } else {
        results.sunrise = null;
        results.sunset = null;
    }

    return results;
}

/**
 * Fetches the HTML content from the website, extracts the specific weather 
 * data block, cleans it, and parses the structured information.
 *
 * @returns {Promise<Object>} A promise that resolves to the structured weather data.
 */
export async function fetchAndParseLERMConditions() {
    const URL = 'https://www.aeroclubdeguadalajara.es/meteo.php';

    try {
        // 1. Fetch the HTML content
        const response = await fetch(URL, {
            headers: {
                'User-Agent': 'ATIS-Scraper-Bot'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const htmlText = await response.text();

        // 2. Extract the specific data block using the new context
        // This regex targets the content inside the <div> with inline styles 
        // that is immediately after <h2>Condiciones Actuales</h2>
        const contentRegex = /<h2>Condiciones Actuales<\/h2>\s*<div[^>]*>(.*?)<\/div>/s;
        const contentMatch = htmlText.match(contentRegex);

        if (!contentMatch || contentMatch.length < 2) {
            throw new Error("Could not find the 'Condiciones Actuales' data block in the HTML.");
        }

        // The captured content contains the raw data with HTML tags
        let dataBlock = contentMatch[1];

        // 3. Clean up the data block
        dataBlock = dataBlock
            .replace(/<br\s*\/?>/g, '\n')  // Convert <br> tags to newlines for parsing
            .replace(/<[^>]*>/g, '')       // Remove all other HTML tags (like <b>, <i>, <span>, etc.)
            .replace(/&nbsp;/g, ' ')       // Replace non-breaking spaces
            .replace(/[\n\r\t]+/g, ' ')    // Replace multiple newlines/tabs with a single space
            .trim();                       // Trim leading/trailing whitespace

        // 4. Parse the cleaned text data
        return parseCleanConditions(dataBlock);

    } catch (error) {
        console.error("Error fetching or parsing weather data:", error.message);
        return { error: `Failed to retrieve external data: ${error.message}` };
    }
}

/**
 * Converts speed from kilometers per hour (km/h) to knots (kt).
 * * @param {number} speedKmh - Speed in kilometers per hour.
 * @returns {number} The speed converted to knots, rounded to the nearest integer.
 */
function convertKmhToKnots(speedKmh) {
    if (typeof speedKmh !== 'number' || speedKmh < 0) {
        return 0;
    }
    // Conversion factor: 1 km/h = 0.539957 knots
    const conversionFactor = 0.539957;

    // Standard aviation reports round knots to the nearest integer.
    return Math.round(speedKmh * conversionFactor);
}

/**
 * Converts a raw observation time string (YYYY-MM-DDTHH:mm:ss) which is 
 * implicitly in 'Europe/Madrid' into the ATIS format (HH:MM Z).
 * This function utilizes the generic getATISTimeFromLocalTime for the conversion logic.
 *
 * @param {string} rawTimeString - The time string in YYYY-MM-DDTHH:mm:ss format.
 * @returns {string} The time formatted as "HH:MM Z" (Zulu time), or "Invalid Date".
 */
function convertToAtisTime(rawTimeString) {
    if (!rawTimeString) {
        return "Time Unavailable";
    }

    // The input format is YYYY-MM-DDTHH:mm:ss, but getATISTimeFromLocalTime
    // expects YYYY-MM-DD HH:MM:SS (space separated). We replace 'T' with a space.
    const spaceSeparatedTime = rawTimeString.replace('T', ' ');

    // Use the generic function, fixing the timezone to 'Europe/Madrid'.
    return getATISTimeFromLocalTime(spaceSeparatedTime, 'Europe/Madrid');
}


/**
 * Converts a specific local time (from a defined IANA timezone)
 * to its corresponding UTC time, formatted in ATIS standard (HH:MM Z).
 *
 * This function is the primary robust time conversion utility.
 * Input format for dateString is expected to be "YYYY-MM-DD HH:MM:SS" (space separated).
 *
 * @param {string} dateString The date/time string (e.g., "2024-11-20 15:30:00").
 * @param {string} timeZoneIANA The IANA timezone code (e.g., "America/Los_Angeles").
 * @returns {string} The time formatted as "HH:MM Z" (Zulu time), or "Invalid Date".
 */
function getATISTimeFromLocalTime(dateString, timeZoneIANA) {
    // 1. Parse the input string into a list of components (Year, Month, Day, Hour, Minute, Second)
    // Assumes input format is "YYYY-MM-DD HH:MM:SS"
    // Splitting by [\s:-] handles spaces, hyphens, and colons.
    const parts = dateString.split(/[\s:-]/).map(Number);

    if (parts.length < 6 || parts.some(isNaN)) {
        console.error("Input string parsing failed.");
        return "Invalid Date";
    }

    // Month is 0-indexed in Date constructor (0=Jan, 11=Dec)
    // Create a NAIVE date object using the components. This date is interpreted
    // using the local system's time zone, but we use it as a reference point.
    const naiveDate = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);

    if (isNaN(naiveDate.getTime())) {
        console.error("Naive date initialization failed.");
        return "Invalid Date";
    }

    // 2. Correctly interpret the Naive Date's timestamp as being in the Target IANA Zone.
    // date.toLocaleString('en-US', { timeZone: IANA }) returns a string representing the
    // local time (in the IANA zone) of the * internal UTC moment* held by 'naiveDate'.
    // We then pass this string back to the Date constructor. This two-step conversion
    // forces the Date object to hold the correct internal UTC timestamp corresponding to
    // the input date/time in the specified IANA zone, correctly handling DST offsets.
    const dateInTargetZoneString = naiveDate.toLocaleString('en-US', { timeZone: timeZoneIANA });

    const finalDateUtc = new Date(dateInTargetZoneString);

    // If parsing fails, the time is invalid.
    if (isNaN(finalDateUtc.getTime())) {
        console.error("Time zone correction failed, resulting in NaN.");
        return "Invalid Date";
    }

    // 3. Extract final UTC components and format to ATIS standard (HH:MM Z).
    const finalHours = finalDateUtc.getUTCHours();
    const finalMinutes = finalDateUtc.getUTCMinutes();

    const formattedHours = String(finalHours).padStart(2, '0');
    const formattedMinutes = String(finalMinutes).padStart(2, '0');

    return `${formattedHours}:${formattedMinutes}Z`;
}
