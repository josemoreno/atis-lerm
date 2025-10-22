// A simplified, translated ATISReport class in JavaScript
class ATISReport {
    constructor(data) {
        Object.assign(this, data);
        this.acknowledgment = `ADVISE ON INITIAL CONTACT YOU HAVE INFO ${this.identifier.toUpperCase()}`;
    }

    get_full_report() {
        // This is the spoken/voice format
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

        // Example of incorporating a dedicated Transition Level (TL) if it were a property
        // if (this.transition_level) {
        //     report_parts.splice(7, 0, `Transition Level ${this.transition_level}.`);
        // }

        if (this.special_info) {
            report_parts.push(`${this.special_info}.`);
        }

        report_parts.push(`${this.acknowledgment}.`);

        // Use a space separator for the spoken report
        return report_parts.join(" ");
    }

    get_datis_report() {
        // This is the compact, digital D-ATIS format
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

        // if (this.transition_level) {
        //     datis_lines.push(`TL: ${this.transition_level.toUpperCase()}`);
        // }

        if (this.special_info) {
            datis_lines.push(`REMARKS: ${this.special_info.toUpperCase()}`);
        }

        datis_lines.push(`ACK: ${this.acknowledgment.toUpperCase()}`);

        // Use newlines for the D-ATIS display
        return datis_lines.join("\n");
    }
}

// Example Data (This would be replaced with external API fetch or other dynamic logic)
const currentAtisData = {
    airport_name: "KDEN",
    identifier: "FOXTROT",
    time_zulu: "1853",
    wind_data: "three five zero at one zero, gusting to two two knots",
    visibility: "one zero statute miles",
    weather_and_clouds: "Sky clear",
    temperature: "one two",
    dew_point: "zero three",
    altimeter: "A two niner point eight nine",
    runways_in_use: "35R ARR / 35L DEP",
    special_info: "TRANSITION LEVEL FL SEVEN ZERO. VOR A APPROACH U/S",
    // transition_level: "FL SEVEN ZERO" // If you added a dedicated property
};

// ----------------------------------------------------------------------
// CLOUDFLARE PAGES FUNCTION HANDLER
// ----------------------------------------------------------------------

/**
 * Handles all requests to the /atis endpoint.
 * Accesses query parameters to determine the report format.
 * * @param {object} context The context object provided by Cloudflare Pages Functions.
 * @returns {Response} A Response object containing the ATIS report text.
 */
export async function onRequest(context) {
    const url = new URL(context.request.url);
    const format = url.searchParams.get('format'); // 'datis' or null (defaults to 'full')

    // 1. Generate the ATIS report object
    const report = new ATISReport(currentAtisData);

    // 2. Select the correct output format
    const reportText = format === 'datis'
        ? report.get_datis_report()
        : report.get_full_report();

    // 3. Return the report as a simple text response
    return new Response(reportText, {
        headers: {
            'Content-Type': 'text/plain',
            'Cache-Control': 'no-cache, no-store, must-revalidate' // Prevent aggressive caching
        },
    });
}