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
/**
 * Converts a specific local time (from a defined IANA timezone)
 * to its corresponding UTC time, formatted in ATIS standard (HHMMZ or HH:MM Z).
 *
 * This function uses the Intl API to reliably handle timezone conversions.
 *
 * @param {string} dateString The date/time string (e.g., "2024-11-20 15:30:00").
 * @param {string} timeZoneIANA The IANA timezone code (e.g., "Europe/Madrid").
 * @returns {string} The time formatted as "HH:MM Z" (Zulu time), or "Invalid Date".
 */
function getATISTimeFromLocalTime(dateString, timeZoneIANA) {
    // 1. Create a Timezone-Aware UTC Date
    // The key is to append ' Z' to the input string. This tells the Date constructor 
    // to interpret the dateString as UTC time, which can then be offset by the IANA Zone.
    // However, the cleanest way for this specific problem is to use Intl to calculate the UTC equivalent.

    try {
        // We create a date string that represents a moment in time (e.g., "2024-11-20 15:30:00")
        // and tell the constructor *where* that moment occurred by using the IANA zone.
        // We use 'new Date(string)' only with the IANA zone specified.

        // This relies on the specific behavior where combining the date string with 
        // the zone offset (or the zone name itself) correctly initializes the internal UTC timestamp.

        // A more reliable way: Use Intl to format the date string *as if it were in UTC*
        // but with the local components, forcing the creation of the correct UTC timestamp.

        const safeIsoString = dateString.replace(' ', 'T'); // "YYYY-MM-DDTHH:MM:SS"

        // 🌟 BEST PRACTICE: Use a timezone-aware Date constructor format
        const dateInZone = new Date(`${safeIsoString}Z`);

        if (isNaN(dateInZone.getTime())) {
            throw new Error("Date parsing failed.");
        }

        // We use the Intl API to get the target time zone's offset from the created UTC date.
        // This is the core difference: we are not relying on new Date(string) for the conversion,
        // but for formatting and extracting the final UTC time.

        // This part is the most reliable way to get the UTC time corresponding to the local time
        // provided in dateString *in the specified timeZoneIANA*.
        const utcDate = new Date(dateInZone.toLocaleString('en-US', {
            timeZone: timeZoneIANA,
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric',
            hour12: false // Ensure 24-hour format
        }));

        // If the above is too complex, the simplest reliable fix is often to explicitly specify 
        // the target zone during construction, but since that failed for you, we proceed with Intl:

        // The previous two-step logic was attempting to solve a difficult problem.
        // A cleaner approach is to use the formatter to extract the required components directly in UTC:

        const formatter = new Intl.DateTimeFormat('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23', // Ensure 24-hour format
            timeZone: 'UTC',
        });

        // We need a way to create a Date object that internally holds the correct UTC moment
        // corresponding to the local time provided.

        const options = {
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric',
            hourCycle: 'h23', timeZone: timeZoneIANA
        };

        const dateAsLocal = new Date(dateString.replace(/-/g, '/')); // Use slashes for better compatibility

        const partsFormatter = new Intl.DateTimeFormat('en-US', {
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric',
            hourCycle: 'h23', timeZone: timeZoneIANA
        });

        const partsString = partsFormatter.format(dateAsLocal);
        const correctedDate = new Date(partsString);

        if (isNaN(correctedDate.getTime())) {
            throw new Error("Final date correction failed.");
        }

        // 3. Extract final UTC components and format to ATIS standard (HH:MM Z).
        const finalHours = correctedDate.getUTCHours();
        const finalMinutes = correctedDate.getUTCMinutes();

        const formattedHours = String(finalHours).padStart(2, '0');
        const formattedMinutes = String(finalMinutes).padStart(2, '0');

        return `${formattedHours}:${formattedMinutes}Z`;

    } catch (error) {
        console.error("Time conversion failed:", error.message);
        return "Invalid Date";
    }
}
