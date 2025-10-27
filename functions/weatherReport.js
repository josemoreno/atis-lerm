/**
 * A dataclass to store and manage the combined weather observation and prediction data.
 */
export class WeatherReportData {
    // --- Class Properties (Ensuring the merge logic knows which fields to accept) ---
    wind_direction;
    wind_speed;
    gust_direction;
    gust_speed;
    visibility;
    temperature;
    dew_point;
    qnh; // Altimeter setting
    prec; // Precipitation amount
    observationTime;
    originalSkyDescription;
    sky;        // Mapped Octas value (e.g., 0-8)
    phenomenon; // Mapped weather phenomenon (e.g., "SHRA")
    wind_vrb;   // Wind variability field
    clouds;
    clouds_short;

    /**
     * Creates a new instance of WeatherReportData, initializing all fields 
     * to the provided values or null/default.
     */
    constructor(initialData = {}) {
        // Initialize all properties to null
        this.wind_direction = null;
        this.wind_speed = null;
        this.gust_direction = null;
        this.gust_speed = null;
        this.visibility = null;
        this.temperature = null;
        this.dew_point = null;
        this.qnh = null;
        this.prec = null;
        this.observationTime = null;
        this.originalSkyDescription = null;
        this.sky = null;
        this.phenomenon = null;
        this.wind_vrb = null;
        this.clouds = null;
        this.clouds_short = null;

        // Merge initial data provided in the constructor
        this.mergeData(initialData);
    }

    /**
         * Merges fields from a plain JavaScript object into the current class instance.
         * Only copies properties that already exist on the class and whose value 
         * in the sourceObject is NOT null.
         * * @param {object} sourceObject - The object containing data to merge.
         */
    mergeData(sourceObject) {
        if (typeof sourceObject !== 'object' || sourceObject === null) {
            console.warn("Merge operation skipped: sourceObject is not a valid object.");
            return;
        }

        for (const key in sourceObject) {
            // Check 1: Ensure the property exists on the class instance
            if (this.hasOwnProperty(key)) {
                // Check 2: Only merge if the source value is NOT null
                if (sourceObject[key] !== null) {
                    this[key] = sourceObject[key];
                }
            }
        }
    }

    /**
     * Static method to create a new instance where all fields are explicitly null.
     */
    static returnNullObject() {
        return new this();
    }
}