// --- AEMET API Constants ---
const COD_ROBLE = "19239";
const ID_EMA_PANTANO_VADO = "3103";
const ID_EMA_GUADA = "3168D"
const AEMET_API = "https://opendata.aemet.es/opendata";
const ENDPOINT_PRED_MUN = "/api/prediccion/especifica/municipio/horaria/";
const ENDPOINT_DATA_IDEMA = "/api/observacion/convencional/datos/estacion/";

/**
 * Handles the two-step AEMET API fetch: initial URL -> final data URL.
 * @param {string} initialUrl The first API endpoint to call.
 * @param {object} headers Request headers including the API key.
 * @returns {Promise<object>} The final JSON data payload.
 */
async function fetchAemetJson(initialUrl, headers) {
    let ret = await fetch(initialUrl, { headers });
    if (!ret.ok) throw new Error(`AEMET Initial API call failed with status: ${ret.status}`);

    let initialData = await ret.json();
    let finalUrl = initialData.datos; // This URL points to the actual data

    let retFinal = await fetch(finalUrl);
    if (!retFinal.ok) throw new Error(`AEMET Data fetch failed with status: ${retFinal.status}`);

    return retFinal.json();
}

/**
 * Processes raw AEMET data to generate a structured object for the ATISReport constructor.
 * ⚠️ You must implement the logic inside this function to correctly map AEMET data
 * to ATIS properties (wind, visibility, altimeter, etc.) 
 * @param {object} predictionData JSON data from the municipal prediction endpoint.
 * @param {object} observationData JSON data from the conventional observation endpoint.
 * @returns {object} Data structured for the ATISReport constructor.
 */
function processAemetData(predictionData, observationDataVado, observationDataGuada) {
    let reportData = {}
    // Example: Getting current time (a quick way to get ZULU time)
    const now = new Date();
    reportData.time = now.getUTCHours().toString().padStart(2, '0') +
        now.getUTCMinutes().toString().padStart(2, '0');
    // EMA GUADA has much more information
    getLatestObservationData(observationDataGuada, reportData)
    // EMA VADO to overwritte the information to a more similar location
    getLatestObservationData(observationDataVado, reportData)
    getSkyState(predictionData, reportData)

    return reportData


    // --- YOUR PROCESSING LOGIC GOES HERE ---
    // You would look at observationData[0].vi (Visibility), predictionData[0].viento (Wind), etc.
    // and format them into the required ATIS spoken phrases.

    // return {
    //     // Placeholder values pending actual AEMET JSON mapping
    //     airport_name: "LERM",
    //     identifier: "BRAVO",
    //     time_zulu: time_zulu,
    //     wind_data: "one eight zero at seven knots",
    //     visibility: "one zero statute miles",
    //     weather_and_clouds: "Few clouds at five thousand",
    //     temperature: "one five",
    //     dew_point: "zero eight",
    //     altimeter: "A two niner point eight niner",
    //     runways_in_use: "05 ARR/DEP",
    //     special_info: "TRANSITION LEVEL FL SEVEN ZERO. VOR A APPROACH U/S"
    // };
}

function getLatestObservationData(observationData, reportData) {
    const latestObservation = findClosestObservation(observationData)
    console.log(latestObservation)
    reportData.wind_direction = latestObservation.dv
    reportData.wind_speed = convertMpsToKnots(latestObservation.vv)
    reportData.gust_direction = latestObservation.dmax
    reportData.gust_speed = convertMpsToKnots(latestObservation.vmax)
    if (latestObservation.vis) {
        reportData.visibility = latestObservation.vis
    }
    reportData.temperature = latestObservation.ta
    if (latestObservation.tpr) {
        reportData.dew_point = latestObservation.tpr
    }
    if (latestObservation.pres_nmar) {
        reportData.qnh = latestObservation.pres_nmar
    }
    reportData.prec = latestObservation.prec
    reportData.observationTime = convertToAtisTime(latestObservation.fint)
}

/**
 * Converts an ISO 8601 time string (e.g., "2025-10-21T18:00:00+0000") 
 * to the ATIS format (HH:MM Z) in Zulu (UTC) time.
 * * @param {string} isoTimeString - The time string in the source format.
 * @returns {string} The time formatted as "HH:MM Z" (e.g., "18:00 Z").
 */
function convertToAtisTime(isoTimeString) {
    // 1. Create a Date object from the input string.
    // The input format is directly parsable by the Date constructor.
    const date = new Date(isoTimeString);

    // Check for invalid date
    if (isNaN(date.getTime())) {
        return "Invalid Time Format";
    }

    // 2. Extract the UTC (Zulu) hour and minute.
    // We use getUTCHours() and getUTCMinutes() to ensure the time is in Zulu/UTC.
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();

    // 3. Format the hours and minutes with leading zeros (e.g., 9 -> 09).
    const formattedHours = String(hours).padStart(2, '0');
    const formattedMinutes = String(minutes).padStart(2, '0');

    // 4. Construct the final ATIS string.
    return `${formattedHours}:${formattedMinutes} Z`;
}

/**
 * Maps the AEMET 'estadoCielo' description to octas (0-8) and identifies specific phenomena.
 * @param {string} aemetDescription - The descriptive value from the AEMET 'estadoCielo'.
 * @returns {Object} An object with 'sky' (octas) and 'phenomenon' (string).
 */
function mapAemetToOctasAndPhenomenon(aemetDescription) {
    const description = aemetDescription.toLowerCase().trim();

    let skyOctas = null;
    let phenomenon = null;

    // --- Octas Mapping ---
    if (description.includes("despejado")) {
        skyOctas = 0;
    } else if (description.includes("poco nuboso")) {
        skyOctas = 2;
    } else if (description.includes("nubes altas")) {
        skyOctas = 1;
        phenomenon = "High Clouds";
    } else if (description.includes("intervalos nubosos")) {
        skyOctas = 4;
    } else if (description.includes("nuboso")) {
        skyOctas = 6;
    } else if (description.includes("muy nuboso")) {
        skyOctas = 7;
    } else if (description.includes("cubierto")) {
        skyOctas = 8;
    }

    // --- Phenomenon Overrides ---
    if (description.includes("lluvia") || description.includes("llovizna")) {
        phenomenon = "Rain";
    } else if (description.includes("nieve")) {
        phenomenon = "Snow";
    } else if (description.includes("tormenta")) {
        phenomenon = "Thunderstorm";
    } else if (description.includes("niebla")) {
        phenomenon = "Fog";
        skyOctas = 8;
    } else if (description.includes("bruma")) {
        phenomenon = "Mist / Haze";
        skyOctas = 8;
    } else if (description.includes("calima")) {
        phenomenon = "Calima (Dust/Sand Haze)";
        skyOctas = 0;
    }

    if (skyOctas === null) {
        skyOctas = 0;
        phenomenon = "Unknown";
    }

    return { sky: skyOctas, phenomenon: phenomenon };
}


/**
 * Finds the sky state prediction closest to the current time and updates 
 * the provided reportData object with the results.
 *
 * @param {Array<Object>} aemetData - The array containing the weather forecast object.
 * @param {Object} reportData - An existing object to be modified and populated.
 * @returns {boolean} True if data was successfully updated, false otherwise.
 */
function getSkyState(aemetData, reportData) {
    if (!aemetData || aemetData.length === 0 || !aemetData[0].prediccion || !aemetData[0].prediccion.dia) {
        return false;
    }

    // Ensure reportData is a valid object before proceeding
    if (typeof reportData !== 'object' || reportData === null) {
        console.error("The second argument must be a valid object.");
        return false;
    }

    const nowTimestamp = new Date().getTime();
    const days = aemetData[0].prediccion.dia;
    let minTimeDiff = Infinity;
    let closestPrediction = null;

    // --- Find the Closest Day and Hour (Logic remains the same) ---
    for (const day of days) {
        const dateString = day.fecha.split('T')[0];
        const hourlyData = day.estadoCielo;

        for (const prediction of hourlyData) {
            const hour = parseInt(prediction.periodo);
            const predictionDateTimeString = `${dateString}T${String(hour).padStart(2, '0')}:00:00`;
            const predictionTimestamp = new Date(predictionDateTimeString).getTime();

            const timeDiff = Math.abs(nowTimestamp - predictionTimestamp);

            if (timeDiff < minTimeDiff) {
                minTimeDiff = timeDiff;
                closestPrediction = {
                    day: dateString,
                    hour: hour,
                    skyDescription: prediction.descripcion,
                    periodoCode: prediction.value
                };
            }
        }
    }

    // --- Update the External Object ---
    if (closestPrediction) {
        const mappedData = mapAemetToOctasAndPhenomenon(closestPrediction.skyDescription);
        reportData.originalSkyDescription = closestPrediction.skyDescription;
        reportData.sky = mappedData.sky;
        reportData.phenomenon = mappedData.phenomenon;
    }
}



/**
 * Parses an AEMET weather code and returns an object with the sky state in octas and the meteorological phenomenon.
 * @param {string} aemetCode The AEMET code to be parsed (e.g., "71n", "53").
 * @returns {{octas: number|string, phenomenon: string}} An object with the octas and the meteorological phenomenon.
 */
function parseAemetCode(aemetCode) {
    const codeStr = String(aemetCode).replace('n', '');
    const code = parseInt(codeStr, 10);
    let octas = 'Unknown';
    let phenomenon = 'No precipitation';

    // Analyze cloud cover to determine octas
    if (code === 11) {
        octas = 0; // Clear
    } else if (code === 12) {
        octas = 2; // Partly cloudy (1-2 octas)
    } else if (code === 13) {
        octas = 4; // Cloudy intervals (3-4 octas)
    } else if (code === 14 || code === 15) {
        octas = 6; // Cloudy or very cloudy (5-7 octas)
    } else if (code === 16) {
        octas = 8; // Overcast (8 octas)
    } else if (code === 17) {
        octas = 6; // High clouds, considered cloudy (5-7 octas)
    } else if (code >= 23 && code <= 26) {
        octas = (code === 23) ? 4 : (code === 24) ? 6 : (code === 25) ? 6 : 8;
        fenomeno = 'Rain';
    } else if (code >= 33 && code <= 36) {
        octas = (code === 33) ? 4 : (code === 34) ? 6 : (code === 35) ? 6 : 8;
        phenomenon = 'Snow';
    } else if (code >= 43 && code <= 46) {
        octas = (code === 43) ? 4 : (code === 44) ? 6 : (code === 45) ? 6 : 8;
        phenomenon = 'Light rain';
    } else if (code >= 71 && code <= 74) {
        octas = (code === 71) ? 4 : (code === 72) ? 6 : (code === 73) ? 6 : 8;
        phenomenon = 'Light snow';
    } else if (code >= 51 && code <= 54) {
        octas = (code === 51) ? 4 : (code === 52) ? 6 : (code === 53) ? 6 : 8;
        phenomenon = 'Thunderstorm';
    } else if (code >= 61 && code <= 64) {
        octas = (code === 61) ? 4 : (code === 62) ? 6 : (code === 63) ? 6 : 8;
        phenomenon = 'Thunderstorm with light rain';
    }
    // Add logic for fog, mist, etc.
    else if (code >= 21 && code <= 30) {
        octas = 8; // Fog and mist considered 8 octas due to opacity
        phenomenon = 'Fog/Mist';
    } else if (code >= 31 && code <= 40) {
        octas = 'Variable'; // Haze can vary cloudiness
        phenomenon = 'Haze';
    }

    return { octas, phenomenon };
}

/**
 * Converts speed from meters per second (m/s) to knots (kt).
 * * Conversion Factor: 1 m/s = 1.94384 knots
 *
 * @param {number} metersPerSecond - The speed in meters per second.
 * @returns {number} The equivalent speed in knots.
 */
function convertMpsToKnots(metersPerSecond) {
    // Define the conversion factor
    const CONVERSION_FACTOR = 1.94384;

    // Check if the input is a valid number
    if (typeof metersPerSecond !== 'number' || isNaN(metersPerSecond)) {
        return NaN; // Return NaN or throw an error for invalid input
    }

    // Perform the conversion
    const knots = metersPerSecond * CONVERSION_FACTOR;

    return knots;
}

function findClosestObservation(observationData) {
    const now = new Date().getTime();

    return observationData.reduce((closest, current) => {
        // Get absolute difference for current object
        const currentTimeDiff = Math.abs(now - new Date(current.fint).getTime());

        // Get absolute difference for the currently closest object
        const closestTimeDiff = Math.abs(now - new Date(closest.fint).getTime());

        // Return the current object if its difference is smaller, otherwise return 'closest'
        return currentTimeDiff < closestTimeDiff ? current : closest;
    }, observationData[0]); // Start with the first element as the initial closest
}

/**
 * Main function to fetch, process, and return ATIS-ready data.
 * @param {string} apiKey The secret AEMET API key.
 * @returns {Promise<object>} The processed data object suitable for ATISReport.
 */
export async function getFormattedAtisData(apiKey) {
    const headers = {
        "Accept": "application/json",
        "api_key": apiKey
    };

    // 1. Fetch Municipal Prediction
    const predictionUrl = `${AEMET_API}${ENDPOINT_PRED_MUN}${COD_ROBLE}`;
    const predictionData = await fetchAemetJson(predictionUrl, headers);

    // 2. Fetch Observation Data
    const observationUrlVado = `${AEMET_API}${ENDPOINT_DATA_IDEMA}${ID_EMA_PANTANO_VADO}`;
    const observationDataVado = await fetchAemetJson(observationUrlVado, headers);
    const observationUrlGuada = `${AEMET_API}${ENDPOINT_DATA_IDEMA}${ID_EMA_GUADA}`;
    const observationDataGuada = await fetchAemetJson(observationUrlGuada, headers);

    // 3. Process and format the data
    return processAemetData(predictionData, observationDataVado, observationDataGuada);
}
