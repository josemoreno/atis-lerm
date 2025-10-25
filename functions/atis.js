// Import the ATIS data fetching function from the local module
import { getFormattedAtisData } from './aemet.js';

// --- ATIS IDENTIFIER LOGIC ---
const ATIS_IDENTIFIERS = [
    "ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT", "GOLF", "HOTEL",
    "INDIA", "JULIET", "KILO", "LIMA", "MIKE", "NOVEMBER", "OSCAR", "PAPA",
    "QUEBEC", "ROMEO", "SIERRA", "TANGO", "UNIFORM", "VICTOR", "WHISKEY",
    "XRAY", "YANKEE", "ZULU"
];

// Initialize the index to the last element (ZULU) so the first call to getNextIdentifier 
// will wrap to ALPHA (0), ensuring the sequence starts correctly.
let currentIdentifierIndex = ATIS_IDENTIFIERS.length - 1;
let LAST_BROADCAST_TIME = null;

/**
 * Calculates and updates the next sequential ATIS identifier (A-Z).
 * The variable is module-scoped, meaning it persists for the life of the worker instance.
 * @returns {string} The next ATIS identifier (e.g., "ALPHA", "BRAVO").
 */
function getNextIdentifier() {
    currentIdentifierIndex = (currentIdentifierIndex + 1) % ATIS_IDENTIFIERS.length;
    return ATIS_IDENTIFIERS[currentIdentifierIndex];
}
// --- END ATIS IDENTIFIER LOGIC ---

/**
 * Prepares and formats raw report data for the ATISReport class, 
 * including logic for rotating the ATIS identifier.
 *
 * @param {Object} reportData - The object populated with raw data (dv, vv, qnh, sky, etc.).
 * @param {string} airport_name - The name of the airport (e.g., "Torrejón").
 * @returns {Object} A new object with all fields formatted and identifier determined.
 */
function formatReportForATIS(reportData, airport_name) {
    const isNewData = reportData.observationTime !== LAST_BROADCAST_TIME;
    let currentIdentifier = ATIS_IDENTIFIERS[currentIdentifierIndex];

    // --- 1. Identifier Management ---
    if (isNewData) {
        // Data has changed (new observation time), so advance the identifier
        currentIdentifier = getNextIdentifier();

        // Update the mock persistence for next run
        LAST_BROADCAST_TIME = reportData.observationTime;

    }

    // --- 2. Wind Formatting ---
    let wind_data = '';
    // Check if wind speed is 0 kt (Calm)
    if (reportData.wind_speed < 1.5) { // Assuming < 1.5 kt is effectively Calm
        wind_data = "WIND CALM";
    } else {
        // Wind Direction (DV) should be 3-digits (045) or VRB if variable/missing
        const direction = reportData.wind_direction ? String(reportData.wind_direction).padStart(3, '0') : "VRB";
        const speed = Math.round(reportData.wind_speed);

        wind_data = `WIND ${direction} DEGREES AT ${speed} KNOTS`;

        // Add gusts if they are significantly higher than the mean wind speed
        if (reportData.gust_speed > speed + 5) { // Gust is 5+ knots higher
            wind_data += ` GUSTING ${Math.round(reportData.gust_speed)} KNOTS`;
        }
    }

    // --- 3. Sky/Cloud Formatting ---
    let weather_and_clouds = '';
    const skyOctas = reportData.sky;
    const phenomenon = reportData.phenomenon;

    // Cloud Layer Description (using Octas)
    if (skyOctas === 0) {
        weather_and_clouds += "SKY CLEAR";
    } else if (skyOctas <= 2) {
        weather_and_clouds += "FEW CLOUDS"; // 1-2 Octas
    } else if (skyOctas <= 4) {
        weather_and_clouds += "SCATTERED CLOUDS"; // 3-4 Octas
    } else if (skyOctas <= 7) {
        weather_and_clouds += "BROKEN CLOUDS"; // 5-7 Octas
    } else { // 8 Octas
        weather_and_clouds += "OVERCAST";
    }

    // Significant Weather/Phenomenon (e.g., Rain, Fog, Thunderstorm)
    if (phenomenon && phenomenon !== 'Clear' && phenomenon !== 'Unknown') {
        weather_and_clouds = `${phenomenon.toUpperCase()} AND ${weather_and_clouds}`;
    }

    // --- 4. Altimeter Formatting (QNH) ---
    // QNH is often reported in hPa (millibars) but sometimes converted to inches Hg (inHg).
    // Assuming the input 'qnh' is in hPa (e.g., 1013), we report it as QNH.
    // Altimeter setting is usually rounded to the nearest integer.
    const altimeter_qnh = `QNH ${Math.round(reportData.qnh)}`;

    // --- 5. Final Report Object Construction ---
    return {
        airport_name: airport_name,
        identifier: currentIdentifier,
        time_zulu: reportData.observationTime, // Already in HH:MM Z format
        wind_data: wind_data,
        visibility: `${reportData.visibility} STATUTE MILES`, // Assuming visibility is numeric
        weather_and_clouds: weather_and_clouds,
        temperature: `${reportData.temperature} CELSIUS`,
        dew_point: `${reportData.dew_point} CELSIUS`,
        altimeter: altimeter_qnh,
        runways_in_use: determineActiveRunway(reportData.wind_direction), // Use the runway function
        special_info: null // Placeholder for NOTAMs, facilities, etc.
    };
}

// --- ATISReport Class (The consumer of the data) ---
class ATISReport {
    constructor(data) {
        Object.assign(this, data);
        this.acknowledgment = `ADVISE ON INITIAL CONTACT YOU HAVE INFO ${this.identifier.toUpperCase()}`;
    }

    get_full_report() {
        let report_parts = [
            `${this.airport_name} Terminal Information ${this.identifier}.`,
            `Time ${this.time_zulu} Zulu.`,
            `Wind ${this.wind_data}.`,
            `Visibility ${this.visibility}.`,
            `${this.weather_and_clouds}.`,
            `Temperature ${this.temperature}, dew point ${this.dew_point}.`,
            `Altimeter ${this.altimeter}.`,
            `Runway(s) in use: ${this.runways_in_use}.`
        ];

        if (this.special_info) {
            report_parts.push(`${this.special_info}.`);
        }

        report_parts.push(`${this.acknowledgment}.`);

        return report_parts.join(" ");
    }

    get_datis_report() {
        const identifierUpper = this.identifier.toUpperCase();
        const wind_brief = this.wind_data.toUpperCase().replace(" KNOTS", "KT").replace(" AT ", " ");
        const altimeter_brief = this.altimeter.toUpperCase().replace("ALTIMETER ", "A").replace("QNH ", "Q").replace(" POINT ", ".");

        let datis_lines = [
            `ATIS ${identifierUpper} ${this.time_zulu}Z`,
            `RWY IN USE: ${this.runways_in_use.toUpperCase()}`,
            `WIND: ${wind_brief}`,
            `VIS: ${this.visibility.toUpperCase().replace(' STATUTE MILES', 'SM')}`,
            `WX/CLD: ${this.weather_and_clouds.toUpperCase().replace('SKY CLEAR', 'SKC')}`,
            `TEMP/DP: ${this.temperature.toUpperCase().replace(' ', '')}/${this.dew_point.toUpperCase().replace(' ', '')}C`,
            `ALTM: ${altimeter_brief}`,
        ];

        if (this.special_info) {
            datis_lines.push(`REMARKS: ${this.special_info.toUpperCase()}`);
        }

        datis_lines.push(`ACK: ${this.acknowledgment.toUpperCase()}`);

        return datis_lines.join("\n");
    }
}


// --- CLOUDFLARE PAGES FUNCTION HANDLER ---
export async function onRequest(context) {
    const url = new URL(context.request.url);
    const format = url.searchParams.get('format');

    // 1. Securely retrieve the API Key from environment variables
    const API_KEY = context.env.AEMET_API_KEY;

    if (!API_KEY) {
        return new Response("Configuration Error: AEMET_API_KEY secret is missing.", { status: 500 });
    }

    try {
        // 2. Fetch and process the weather data using the external module
        const rawData = await getFormattedAtisData(API_KEY);
        atisData = formatReportForATIS(rawData)

        // 3. Generate the ATIS report object
        const report = new ATISReport(atisData);

        // 4. Select and format the final output
        const reportText = format === 'datis'
            ? report.get_datis_report()
            : report.get_full_report();

        return new Response(reportText, {
            headers: {
                'Content-Type': 'text/plain',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            },
        });

    } catch (error) {
        console.error("ATIS Generation Error:", error.message);
        return new Response(`Server Error fetching weather data: ${error.message}`, {
            status: 500,
            headers: { 'Content-Type': 'text/plain' }
        });
    }
}


/**
 * Determines the active runway (01 or 19) based on magnetic wind direction.
 * The function assumes a simple binary choice to align with the wind for safety and efficiency.
 *
 * @param {number} windDirectionDegrees - The magnetic wind direction in degrees (0-360).
 * @returns {string} The suggested active runway ("01" or "19").
 */
function determineActiveRunway(windDirectionDegrees) {
    // 1. Define the magnetic headings for the two runways.
    const RWY_01_HDG = 10;  // 010 degrees
    const RWY_19_HDG = 190; // 190 degrees

    // 2. Normalize the wind direction to be within 0-360 degrees, just in case.
    const windDir = windDirectionDegrees % 360;

    // 3. Determine the difference between the wind and each runway heading.
    // The calculation needs to handle the wrap-around at 360/0 degrees.

    // Function to calculate the smallest angular difference (0-180)
    const getAngularDifference = (angle1, angle2) => {
        let diff = Math.abs(angle1 - angle2);
        // If difference is greater than 180, subtract it from 360
        return Math.min(diff, 360 - diff);
    };

    const diffRwy01 = getAngularDifference(windDir, RWY_01_HDG);
    const diffRwy19 = getAngularDifference(windDir, RWY_19_HDG);

    // 4. Select the runway that minimizes the angular difference (i.e., closest to the wind).
    if (diffRwy01 <= diffRwy19) {
        // Runway 01 is closer to the wind direction.
        return "01";
    } else {
        // Runway 19 is closer to the wind direction.
        return "19";
    }
}

/**
 * Determines the active runway (01 or 19) based on magnetic wind direction.
 * The function assumes a simple binary choice to align with the wind for safety and efficiency.
 *
 * @param {number} windDirectionDegrees - The magnetic wind direction in degrees (0-360).
 * @returns {string} The suggested active runway ("01" or "19").
 */
function determineActiveRunway(windDirectionDegrees) {
    // 1. Define the magnetic headings for the two runways.
    const RWY_01_HDG = 10;  // 010 degrees
    const RWY_19_HDG = 190; // 190 degrees

    // 2. Normalize the wind direction to be within 0-360 degrees, just in case.
    const windDir = windDirectionDegrees % 360;

    // 3. Determine the difference between the wind and each runway heading.
    // The calculation needs to handle the wrap-around at 360/0 degrees.

    // Function to calculate the smallest angular difference (0-180)
    const getAngularDifference = (angle1, angle2) => {
        let diff = Math.abs(angle1 - angle2);
        // If difference is greater than 180, subtract it from 360
        return Math.min(diff, 360 - diff);
    };

    const diffRwy01 = getAngularDifference(windDir, RWY_01_HDG);
    const diffRwy19 = getAngularDifference(windDir, RWY_19_HDG);

    // 4. Select the runway that minimizes the angular difference (i.e., closest to the wind).
    if (diffRwy01 <= diffRwy19) {
        // Runway 01 is closer to the wind direction.
        return "01";
    } else {
        // Runway 19 is closer to the wind direction.
        return "19";
    }
}