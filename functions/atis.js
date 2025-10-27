// Import the ATIS data fetching function from the local module
import { getFormattedAtisData } from './aemet.js';
import { fetchAndParseLERMConditions } from './robleEMA.js'
import { fetchWindyData } from './windy.js';
import { WeatherReportData } from './weatherReport.js';

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
 * @returns {Object} A new object with all fields formatted and identifier determined.
 */
function formatReportForATIS(reportData) {
    const isNewData = reportData.observationTime !== LAST_BROADCAST_TIME;
    let currentIdentifier = ATIS_IDENTIFIERS[currentIdentifierIndex];

    // --- 1. Identifier Management ---
    if (isNewData) {
        // Data has changed (new observation time), so advance the identifier
        currentIdentifier = getNextIdentifier();

        // Update the mock persistence for next run
        LAST_BROADCAST_TIME = reportData.observationTime;

    }
    // --- 3. Sky/Cloud Formatting ---
    let clouds = '';
    let clouds_short = '';
    let weather_phen = '';
    // const skyOctas = reportData.sky;
    const phenomenon = reportData.phenomenon;

    // // Cloud Layer Description (using Octas)
    // if (skyOctas === 0) {
    //     clouds += "SKY CLEAR";
    //     clouds_short += "SKC";
    // } else if (skyOctas <= 2) {
    //     clouds += "FEW"; // 1-2 Octas
    //     clouds_short += "FEW";
    // } else if (skyOctas <= 4) {
    //     clouds += "SCATTERED"; // 3-4 Octas
    //     clouds_short += "SCT";
    // } else if (skyOctas <= 7) {
    //     clouds += "BROKEN"; // 5-7 Octas
    //     clouds_short += "BKN";
    // } else { // 8 Octas
    //     clouds += "OVERCAST";
    //     clouds_short += "OVC";
    // }

    // Significant Weather/Phenomenon (e.g., Rain, Fog, Thunderstorm)
    if (phenomenon && phenomenon !== 'Clear' && phenomenon !== 'Unknown') {
        weather_phen = `${phenomenon.toUpperCase()}`;
    }

    // --- 4. Altimeter Formatting (QNH) ---
    // QNH is often reported in hPa (millibars) but sometimes converted to inches Hg (inHg).
    // Assuming the input 'qnh' is in hPa (e.g., 1013), we report it as QNH.
    // Altimeter setting is usually rounded to the nearest integer.
    const altimeter_qnh = `QNH ${Math.round(reportData.qnh)}`;

    // --- 5. Final Report Object Construction ---
    return {
        airport_name: "LERM",
        identifier: currentIdentifier,
        time_zulu: reportData.observationTime, // Already in HH:MM Z format
        wind_direction: reportData.wind_direction,
        wind_dir_f: String(reportData.wind_direction).padStart(3, '0'),
        wind_speed: reportData.wind_speed,
        wind_vrb: reportData.wind_vrb,
        gust_direction: reportData.gust_direction,
        gust_dir_f: String(reportData.gust_direction).padStart(3, '0'),
        gust_speed: Math.round(reportData.gust_speed),
        visibility: reportData.visibility, // Assuming visibility is numeric
        clouds: reportData.clouds.join(", "),
        clouds_short: reportData.clouds_short.join("\t\n"),
        phen: weather_phen,
        temperature: `${Math.round(reportData.temperature)}`,
        dew_point: `${Math.round(reportData.dew_point)}`,
        altimeter: altimeter_qnh,
        runways_in_use: determineActiveRunway(reportData.wind_direction), // Use the runway function
        special_info: null // Placeholder for NOTAMs, facilities, etc.
    };
}

// --- ATISReport Class (The consumer of the data) ---
class ATISReport {
    constructor(data) {
        Object.assign(this, data);
        this.acknowledgment = `CONFIRM ATIS INFO ${this.identifier.toUpperCase()} ON INITIAL CONTACT`;
    }

    get_full_report() {
        let wind_gust = ""
        if (this.gust_speed > 0) {
            wind_gust = `Gusting ${this.gust_dir_f} at ${this.gust_speed} knots`
        }
        let wind_vrb = ""
        if (this.wind_vrb) {
            wind_vrb = `Variable from ${this.wind_vrb}`.replace("/", " to ").replace("VRB ", "")
        }
        let vis_clouds = ''
        if (this.visibility > 10 && this.clouds == "SKY CLEAR") {
            vis_clouds = "CAVOK\n"
        } else if (this.clouds == "SKY CLEAR") {
            if (this.phen) {
                vis_clouds = `Visibility ${this.visibility} kilometers\n${this.phen}\n${this.clouds}\n`
            } else {
                vis_clouds = `Visibility ${this.visibility} kilometers\nClouds ${this.clouds}\n`

            }
        } else {
            if (this.phen) {
                vis_clouds = `Visibility ${this.visibility} kilometers\n${this.phen}\nClouds ${this.clouds}\n`
            } else {
                vis_clouds = `Visibility ${this.visibility} kilometers\nClouds ${this.clouds}\n`

            }
        }

        let report_parts = [
            `${this.airport_name} Terminal Information ${this.identifier}.\n`,
            `Time ${this.time_zulu}\n`.replace("Z", " Zulu."),
            `Visual Approach. Runway in use: ${this.runways_in_use}. Transition level 140.\n`,
            `Frequency 123.325\n`,
            `Wind ${this.wind_dir_f} at ${this.wind_speed} knots. ${wind_gust}. ${wind_vrb}\n`,
            `${vis_clouds}`,
            `Temperature ${this.temperature} degrees Celsius, dew point ${this.dew_point} degrees Celsius.\n`,
            `${this.altimeter}.\n`
        ];

        if (this.special_info) {
            report_parts.push(`${this.special_info}.`);
        }

        report_parts.push(`${this.acknowledgment}.`);

        return report_parts.join(" ");
    }

    get_datis_report() {
        const identifierUpper = this.identifier.toUpperCase();
        let vis_clouds = ""
        if (this.visibility > 10 && this.clouds == "SKY CLEAR") {
            vis_clouds = "CAVOK"
        } else {
            if (this.phen) {
                vis_clouds = `VIS ${this.visibility} KM\n${this.phen}\nClouds ${this.clouds_short}`
            } else {
                vis_clouds = `VIS ${this.visibility} KM\nClouds ${this.clouds_short}`

            }
        }
        let wind_gust = ""
        if (this.gust_speed > 0) {
            wind_gust = `${this.gust_dir_f}/${this.gust_speed}`
        }
        console.log(this.wind_vrb)
        let datis_lines = [
            `LERM ATIS INFORMATION ${identifierUpper} ${this.time_zulu}`.replace(":", ""),
            `VFR APP RWY ${this.runways_in_use.toUpperCase()} TL 140`,
            `FREQ 123.325`,
            `WIND ${this.wind_dir_f}/${this.wind_speed} ${wind_gust} ${this.wind_vrb}`,
            `${vis_clouds}`,
            `TEMP/DP ${this.temperature.toUpperCase().replace(' ', '')}/${this.dew_point.toUpperCase().replace(' ', '')}`,
            `${this.altimeter}`,
        ];

        if (this.special_info) {
            datis_lines.push(`REMARKS: ${this.special_info.toUpperCase()}`);
        }

        datis_lines.push(`${this.acknowledgment.toUpperCase()}`);

        return datis_lines.join("\n");
    }
}


// --- CLOUDFLARE PAGES FUNCTION HANDLER ---
export async function onRequest(context) {
    // Note: The URL and format parsing are no longer necessary for the primary logic
    // const url = new URL(context.request.url);
    // const format = url.searchParams.get('format'); 

    // 1. Securely retrieve the API Key from environment variables
    // Re-enabling environment variable usage (recommended for production)
    const AEMET_API_KEY = context.env.AEMET_API_KEY;
    if (!AEMET_API_KEY) {
        return new Response("Configuration Error: AEMET_API_KEY secret is missing.", { status: 500 });
    }

    const WINDY_API_KEY = context.env.WINDY_API_KEY;
    if (!WINDY_API_KEY) {
        return new Response("Configuration Error: WINDY_API_KEY secret is missing.", { status: 500 });
    }

    try {
        const weatherReport = new WeatherReportData()
        // 2. Fetch and process the weather data (all steps remain the same)
        const windyData = await fetchWindyData(WINDY_API_KEY)
        weatherReport.mergeData(windyData);
        const aemetData = await getFormattedAtisData(AEMET_API_KEY);
        weatherReport.mergeData(aemetData);
        const LERMData = await fetchAndParseLERMConditions();
        weatherReport.wind_vrb = getVRBWind(weatherReport.wind_direction, LERMData.wind_direction);
        weatherReport.mergeData(LERMData);
        const atisData = formatReportForATIS(weatherReport);

        // 3. Generate the ATIS report object
        const report = new ATISReport(atisData);

        // 4. Generate BOTH report formats
        const fullReport = report.get_full_report();
        const datisReport = report.get_datis_report();

        // 5. Return a single JSON response containing both reports
        const combinedReports = {
            fullReport: fullReport,
            datisReport: datisReport,
            rawAemet: aemetData,
            rawLerm: LERMData,
            rawWindy: windyData
        };

        return new Response(JSON.stringify(combinedReports), {
            headers: {
                // IMPORTANT: Set Content-Type to application/json
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            },
        });

    } catch (error) {
        console.error("ATIS Generation Error:", error.message);
        // Return a JSON error response structure for client consistency
        const errorResponse = {
            fullReport: "SERVER ERROR: " + error.message,
            datisReport: "SERVER ERROR: " + error.message
        };
        return new Response(JSON.stringify(errorResponse), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

function mergeEMAs(aemetData, LERMData) {
    const report = { ...aemetData };
    // If LERM EMA is online, overwrite some of the values
    report.wind_vrb = "";
    if (LERMData.observationTime_raw) {
        report.observationTime = LERMData.observationTime_atis
        report.temperature = (LERMData.temperature_c) ? LERMData.temperature_c : report.temperature
        if (LERMData.wind_speed_knots != null) {
            report.wind_speed = LERMData.wind_speed_knots
            report.wind_vrb = getVRBWind(report.wind_direction, LERMData.wind_direction_degrees)
            report.wind_direction = LERMData.wind_direction_degrees
        }
        report.qnh = (LERMData.qnh_hpa != null) ? LERMData.qnh_hpa : report.qnh
        report.sunrise = LERMData.sunrise
        report.sunset = LERMData.sunset
    }
    return report
}

/**
 * Calculates and formats wind variability (VRB) for two wind directions, 
 * using the shortest angular difference (circular math).
 * * @param {number} windDir1 - First wind direction in degrees (0-360).
 * @param {number} windDir2 - Second wind direction in degrees (0-360).
 * @returns {string} Formatted variability string (e.g., "VRB 360/023") or "" if no variability.
 */
function getVRBWind(windDir1, windDir2) {
    // 1. Initial Checks and Rounding
    if (windDir1 == null || windDir2 == null) {
        return "";
    }

    // Round the input directions to the nearest integer
    const dir1 = Math.round(windDir1);
    const dir2 = Math.round(windDir2);

    // If directions are identical, there is no variability to report
    if (dir1 === dir2) {
        return "";
    }

    // 2. Calculate the Shortest Angular Difference (The Core Fix)

    // Calculate the absolute difference (straight line difference)
    const diff = Math.abs(dir1 - dir2);

    // The shortest path is the minimum of (straight difference, 360 - straight difference).
    const shortestDiff = Math.min(diff, 360 - diff);

    // If the shortest difference is greater than 60 degrees, variability is typically reported.
    // However, for ATIS/METAR, variability reporting (e.g., 340V030) usually occurs 
    // when the difference is > 60 degrees AND the speed is > 3 knots.
    // For your function, we focus only on the shortest angular report format.

    // 3. Determine the Reporting Order (Lowest degree first)

    let minDir;
    let maxDir;

    // Case 1: The shortest path does NOT cross the 360/0 boundary (e.g., 100 and 150)
    if (diff === shortestDiff) {
        minDir = Math.min(dir1, dir2);
        maxDir = Math.max(dir1, dir2);
    }
    // Case 2: The shortest path DOES cross the 360/0 boundary (e.g., 360 and 23)
    // The "lowest" direction is the one near 360 (or 0), and the "highest" is the other.
    else {
        // When crossing 360/0, the smaller number (e.g., 23) is the max, 
        // and the larger number (e.g., 360) is the min in the sequence.
        minDir = Math.max(dir1, dir2); // The degree closer to 360 (e.g., 360)
        maxDir = Math.min(dir1, dir2); // The degree closer to 0 (e.g., 23)
    }

    // 4. Handle 360/0 Reporting Convention
    // Aviation standards prefer 000 over 360, but since the raw data might use 360,
    // we convert the final output 360 back to 000 if it's the smaller number.
    // Since your request specifically mentioned VRB 360/23, we'll maintain that format, 
    // but ensure the order is correct.

    // Format the degrees to be three digits (e.g., 23 -> 023)
    const formattedMin = String(minDir).padStart(3, '0');
    const formattedMax = String(maxDir).padStart(3, '0');

    // Return the required VRB format
    return "VRB " + formattedMin + "/" + formattedMax;
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
