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
        results.observationTime = convertToAtisTime(results.observationTime_raw)
    } else {
        results.observationTime_raw = null;
    }

    // 2. Temperature
    const tempMatch = rawText.match(tempRegex);
    results.temperature = tempMatch ? parseFloat(tempMatch[1]) : null;

    // 3. Wind (Key change: using the Spanish direction parser)
    const windMatch = rawText.match(windRegex);
    if (windMatch) {
        const speed_kmh = parseFloat(windMatch[1]);
        const direction_text = windMatch[2].toUpperCase();

        results.wind_speed = convertKmhToKnots(speed_kmh);
        results.wind_direction_text = direction_text;

        // *** CALLING THE SPANISH DIRECTION FUNCTION ***
        results.wind_direction = directionToDegrees(direction_text);
    } else {
        // Default to calm/variable
        results.wind_speed = null;
        results.wind_direction = null;
    }

    // 4. QNH
    const qnhMatch = rawText.match(qnhRegex);
    results.qnh = qnhMatch ? parseInt(qnhMatch[1]) : null;

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
 * Converts a specific local time in the Europe/Madrid zone (UTC+1 or UTC+2)
 * to its corresponding UTC time, formatted as HHMMZ.
 * * @param {string} dateString The date/time string (e.g., "2025-10-27 15:30:00").
 * @param {string} timeZoneIANA Must be "Europe/Madrid" or similar EU zone for this logic.
 * @returns {string} The time formatted as "HHMMZ", or "Invalid Date".
 */
function getATISTimeFromLocalTime(dateString, timeZoneIANA) {
    if (!dateString || !timeZoneIANA) return "Invalid Date";

    // 1. Parse the input components (YYYY, M, D, H, M, S)
    const parts = dateString.split(/[\s:-]/).map(Number);
    if (parts.length < 6 || parts.some(isNaN)) {
        console.error("Input string parsing failed.");
        return "Invalid Date";
    }

    const year = parts[0];
    const month = parts[1];
    const day = parts[2];
    const hour = parts[3];
    const minute = parts[4];

    // 2. Helper function to find the last Sunday of a month
    function getLastSunday(year, month) {
        // month is 1-indexed (3 for March, 10 for October)
        // Find the 1st of the next month (or 1st of Jan next year if month is Dec)
        const date = new Date(year, month, 1);

        // Back up one day to get the last day of the target month
        date.setDate(date.getDate() - 1);

        // Calculate how many days to go back to find the Sunday (0=Sunday)
        const dayOfWeek = date.getDay();
        const daysToSubtract = dayOfWeek === 0 ? 0 : dayOfWeek;

        // Set the date to the last Sunday
        date.setDate(date.getDate() - daysToSubtract);

        return date;
    }

    // 3. Determine DST start and end dates for the given year
    const dstStarts = getLastSunday(year, 3); // Last Sunday of March
    const dstEnds = getLastSunday(year, 10);  // Last Sunday of October

    // Since DST changes at 02:00 (March) and 03:00 (October), 
    // we set the changeover times for comparison purposes.
    dstStarts.setHours(2, 0, 0, 0);
    dstEnds.setHours(3, 0, 0, 0);

    // 4. Create a single timestamp for the input time (interpreted as local time)
    // We create a Date object interpreted as UTC, so its timestamp is absolute.
    const localTimeMs = Date.UTC(year, month - 1, day, hour, minute);

    // 5. Determine the offset (1 or 2 hours)
    let offsetHours;

    // Convert changeover dates to milliseconds for comparison
    const dstStartsMs = dstStarts.getTime();
    const dstEndsMs = dstEnds.getTime();

    // The period between the start (inclusive) and the end (exclusive) is UTC+2
    if (localTimeMs >= dstStartsMs && localTimeMs < dstEndsMs) {
        // Summer Time: UTC+2 (Central European Summer Time, CEST)
        offsetHours = 2;
    } else {
        // Winter Time: UTC+1 (Central European Time, CET)
        offsetHours = 1;
    }

    // 6. Calculate UTC time by subtracting the offset
    // Offset in milliseconds
    const offsetMs = offsetHours * 60 * 60 * 1000;

    // UTC time in milliseconds
    const utcTimeMs = localTimeMs - offsetMs;

    // 7. Create a Date object from the UTC timestamp and extract HHMMZ
    const finalDate = new Date(utcTimeMs);

    const finalHours = finalDate.getUTCHours();
    const finalMinutes = finalDate.getUTCMinutes();

    const formattedHours = String(finalHours).padStart(2, '0');
    const formattedMinutes = String(finalMinutes).padStart(2, '0');

    return `${formattedHours}${formattedMinutes}Z`;
}
