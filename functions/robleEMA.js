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
        'N': 0,    // Norte (North)
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
    const windRegex = /Viento:\s*([\d.]+)\s*km\/h\s*del\s*([A-Z]+)\.?;/i; // Captures N, S, O, etc.
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
async function fetchAndParseLERMConditions() {
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
 * implicitly in the 'Europe/Madrid' time zone (CET/CEST) into the ATIS 
 * format (HH:MM Z).
 *
 * @param {string} rawTimeString - The time string in YYYY-MM-DDTHH:mm:ss format (CET/CEST).
 * @returns {string} The time formatted as "HH:MM Z" (e.g., "13:20 Z").
 */
function convertToAtisTime(rawTimeString) {
    if (!rawTimeString) {
        return "Time Unavailable";
    }

    // 1. Append a generic offset to create a parsable Date object.
    // The date constructor is typically unreliable for time zone names,
    // so we construct a date object using its components.
    const dateParts = rawTimeString.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (!dateParts) {
        return "Invalid Time Format";
    }

    // Create a new Date object representing the time in the specified time zone (Europe/Madrid).
    // The easiest way to force this interpretation is using the Date constructor with the timezone, 
    // but that is only available in node, not workers. We must use Intl for robust offset calculation.

    // This creates a date object based on the current *local* system's time zone, 
    // which is not what we want, but it serves as a basis for Intl calculations.
    const date = new Date(rawTimeString);

    // --- Dynamic Offset Calculation (Intl Method) ---

    /**
     * Helper to dynamically calculate the time zone offset in minutes 
     * for a given time zone and date.
     */
    const getOffsetMinutes = (timeZone, date) => {
        // Create two equivalent dates, one forced to UTC and one forced to the local time zone.
        const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC', timeStyle: 'long', dateStyle: 'full' }));
        const localDateInZone = new Date(date.toLocaleString('en-US', { timeZone, timeStyle: 'long', dateStyle: 'full' }));

        // The difference in milliseconds between the two reveals the offset (60 min for CET, 120 min for CEST)
        const diffMs = localDateInZone.getTime() - utcDate.getTime();
        return Math.round(diffMs / 60000); // Convert milliseconds to minutes
    };

    try {
        const offsetMinutes = getOffsetMinutes('Europe/Madrid', date);

        // --- Apply the Offset ---
        // UTC Time = Local Time - Offset
        // We adjust the time by subtracting the offset minutes determined dynamically.
        date.setMinutes(date.getMinutes() - offsetMinutes);

        // After adjustment, we extract the UTC (Zulu) hour and minute.
        const hours = date.getUTCHours();
        const minutes = date.getUTCMinutes();

        const formattedHours = String(hours).padStart(2, '0');
        const formattedMinutes = String(minutes).padStart(2, '0');

        return `${formattedHours}:${formattedMinutes} Z`;

    } catch (e) {
        // Fallback if Intl is not supported or throws an error (e.g., environment doesn't know 'Europe/Madrid')
        console.error("Intl Time Zone error:", e.message);

        // Fallback assumes CET (UTC+1) is active (60 minutes)
        date.setMinutes(date.getMinutes() - 60);
        const hours = date.getUTCHours();
        const minutes = date.getUTCMinutes();
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} Z (Fallback)`;
    }
}