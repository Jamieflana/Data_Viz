let choroplethSVG;
let choroplethProjection;
let choroplethPath;
let choroplethGroup;
let choroplethZoom;
let choroplethLegendGroup;

const CHORO_DURATION = 600;
const CHORO_EASE = d3.easeCubicInOut;

let worldDataLoaded = false;
let worldGeoJSON;

//SANKEY -> CHOROPLETH HIGHLIGHT BRIDGE

let CURRENT_COUNTRY_COUNTS = new Map();

window.highlightRegionOnMap = function (regionName) {
  if (!window.COUNTRY_REGION_MAP) return;

  const targetCountries = Object.entries(COUNTRY_REGION_MAP)
    .filter(([country, region]) => region === regionName)
    .map(([country]) => country);

  choroplethGroup
    .selectAll("path.country")
    .transition()
    .duration(200)
    .ease(d3.easeCubicOut)
    .attr("opacity", (d) =>
      targetCountries.includes(d.properties.name.trim()) ? 1.0 : 0.45
    )
    .attr("stroke-width", (d) =>
      targetCountries.includes(d.properties.name.trim()) ? 2 : 0.5
    )
    .attr("stroke", (d) =>
      targetCountries.includes(d.properties.name.trim()) ? "#000" : "#fff"
    );
};

window.resetMapHighlight = function () {
  choroplethGroup
    .selectAll("path.country")
    .transition()
    .duration(200)
    .ease(d3.easeCubicOut)
    .attr("opacity", 1.0)
    .attr("stroke", "#fff")
    .attr("stroke-width", 0.5);
};

//LOAD WORLD MAP DATA
d3.json("data/world.json").then((world) => {
  worldGeoJSON = topojson.feature(world, world.objects.countries);
  worldDataLoaded = true;

  initializeChoropleth();
  updateChoropleth([]);
});

//INITIALIZE CHOROPLETH (ONCE)
function initializeChoropleth() {
  const container = document.getElementById("choropleth");
  const width = container.clientWidth;
  const height = container.clientHeight || 520;

  d3.select("#choropleth").select("svg").remove();

  choroplethSVG = d3
    .select("#choropleth")
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .style("background", "#2a2c38");

  choroplethGroup = choroplethSVG.append("g");

  choroplethProjection = d3
    .geoNaturalEarth1()
    .center([0, 10])
    .scale(width / 7)
    .translate([width / 2, height / 2]);

  choroplethPath = d3.geoPath().projection(choroplethProjection);

  // DRAW COUNTRIES ONCE
  choroplethGroup
    .selectAll("path.country")
    .data(worldGeoJSON.features, (d) => d.properties.name)
    .enter()
    .append("path")
    .attr("class", "country")
    .attr("d", choroplethPath)
    .attr("data-country", (d) => d.properties.name.trim())
    .attr("fill", "#555")
    .attr("stroke", "#fff")
    .attr("stroke-width", 0.5);

  //LEGEND CONTAINER (ONCE)
  choroplethLegendGroup = choroplethSVG
    .append("g")
    .attr("class", "choropleth-legend")
    .attr("transform", `translate(${width - 850}, 250)`);

  //ZOOM BEHAVIOR

  choroplethZoom = d3
    .zoom()
    .scaleExtent([1, 8])
    .on("zoom", (event) => {
      choroplethGroup.attr("transform", event.transform);
      choroplethGroup
        .selectAll("path.country")
        .attr("stroke-width", 0.5 / event.transform.k);
    });

  choroplethSVG.call(choroplethZoom);
  choroplethSVG.on("dblclick.zoom", resetZoom);
}

//RESET ZOOM

function resetZoom() {
  choroplethSVG
    .transition()
    .duration(750)
    .ease(d3.easeCubicInOut)
    .call(choroplethZoom.transform, d3.zoomIdentity);
}

//UPDATE CHOROPLETH (ANIMATED)
function updateChoropleth(filteredData) {
  if (!worldDataLoaded || !choroplethSVG) return;

  //COMPUTE TRANSFER COUNTS

  const countryCount = d3.rollup(
    filteredData,
    (v) => v.length,
    (d) => d.counter_team_country.trim()
  );
  CURRENT_COUNTRY_COUNTS = countryCount;

  const values = [...countryCount.values()].filter((d) => d > 0);
  const maxCount = d3.max(values) || 1;
  const minCount = d3.min(values) || 1;

  // CONDITIONAL COLOUR SCALE

  const isLog = maxCount > 20;

  const colorScale = isLog
    ? d3.scaleSequentialLog(d3.interpolatePlasma).clamp(true)
    : d3.scaleSequential(d3.interpolatePlasma);

  colorScale.domain([minCount, maxCount]);

  //COLOR TRANSITIONS

  choroplethGroup
    .selectAll("path.country")
    .transition()
    .duration(CHORO_DURATION)
    .ease(CHORO_EASE)
    .attr("fill", (d) => {
      const name = d.properties.name.trim();
      const count = countryCount.get(name) || 0;
      return count > 0 ? colorScale(count) : "#555";
    })
    .attr("opacity", 1.0);

  //UPDATE LEGEND

  updateLegend(colorScale, minCount, maxCount, isLog);

  //AUTOZOOM;

  if (filteredData.length > 0) {
    const activeCountries = worldGeoJSON.features.filter((f) => {
      const name = f.properties.name.trim();
      return countryCount.has(name) && countryCount.get(name) > 0;
    });

    if (activeCountries.length > 0) {
      const bounds = choroplethPath.bounds({
        type: "FeatureCollection",
        features: activeCountries,
      });

      const dx = bounds[1][0] - bounds[0][0];
      const dy = bounds[1][1] - bounds[0][1];
      const x = (bounds[0][0] + bounds[1][0]) / 2;
      const y = (bounds[0][1] + bounds[1][1]) / 2;

      const container = document.getElementById("choropleth");
      const width = container.clientWidth;
      const height = container.clientHeight || 520;

      const scale = Math.max(
        1,
        Math.min(8, 0.9 / Math.max(dx / width, dy / height))
      );

      choroplethSVG
        .transition()
        .duration(750)
        .ease(d3.easeCubicInOut)
        .call(
          choroplethZoom.transform,
          d3.zoomIdentity
            .translate(width / 2 - scale * x, height / 2 - scale * y)
            .scale(scale)
        );
    } else {
      resetZoom();
    }
  } else {
    resetZoom();
  }

  //INTERACTIVITY

  choroplethGroup
    .selectAll("path.country")
    .style("cursor", (d) =>
      (countryCount.get(d.properties.name.trim()) || 0) > 0
        ? "pointer"
        : "default"
    )
    .on("mouseover", function (event, d) {
      const name = d.properties.name.trim();
      const count = countryCount.get(name) || 0;
      if (count === 0) return;

      d3.select(this)
        .raise()
        .attr("stroke", "#333")
        .attr("stroke-width", 2)
        .style("filter", "brightness(0.9)");

      showTooltip(event, `<strong>${name}</strong><br>${count} transfers`);
    })
    .on("mouseout", function () {
      d3.select(this)
        .attr("stroke", "#fff")
        .attr("stroke-width", 0.5)
        .style("filter", "none");

      hideTooltip();
    });
}

// LEGEND RENDERING

function updateLegend(colorScale, minVal, maxVal, isLog) {
  choroplethLegendGroup.selectAll("*").remove();

  const legendWidth = 120;
  const legendHeight = 10;

  // Title
  choroplethLegendGroup
    .append("text")
    .attr("x", 0)
    .attr("y", -6)
    .style("font-size", "11px")
    .style("fill", "#eee")
    .text("Transfers");

  // Gradient
  const gradientId = "choropleth-gradient";

  const defs = choroplethSVG.select("defs").empty()
    ? choroplethSVG.append("defs")
    : choroplethSVG.select("defs");

  const gradient = defs
    .selectAll(`#${gradientId}`)
    .data([null])
    .join("linearGradient")
    .attr("id", gradientId);

  gradient
    .selectAll("stop")
    .data(d3.range(0, 1.01, 0.1))
    .join("stop")
    .attr("offset", (d) => `${d * 100}%`)
    .attr("stop-color", (d) => colorScale(minVal + d * (maxVal - minVal)));

  choroplethLegendGroup
    .append("rect")
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .attr("fill", `url(#${gradientId})`);

  // Min / max labels
  choroplethLegendGroup
    .append("text")
    .attr("x", 0)
    .attr("y", legendHeight + 12)
    .style("font-size", "10px")
    .style("fill", "#ccc")
    .text(minVal);

  choroplethLegendGroup
    .append("text")
    .attr("x", legendWidth)
    .attr("y", legendHeight + 12)
    .attr("text-anchor", "end")
    .style("font-size", "10px")
    .style("fill", "#ccc")
    .text(maxVal);

  // Scale hint
  choroplethLegendGroup
    .append("text")
    .attr("x", legendWidth / 2)
    .attr("y", legendHeight + 26)
    .attr("text-anchor", "middle")
    .style("font-size", "9px")
    .style("fill", "#aaa")
    .text(isLog ? "log scale" : "linear scale");
}

// TOOLTIP FUNCTIONS

function showTooltip(event, html) {
  let tooltip = d3.select("#mapTooltip");

  if (tooltip.empty()) {
    tooltip = d3
      .select("body")
      .append("div")
      .attr("id", "mapTooltip")
      .style("position", "fixed")
      .style("background", "rgba(32, 33, 40, 0.95)")
      .style("padding", "4px 6px")
      .style("border", "1px solid #555")
      .style("border-radius", "6px")
      .style("color", "#f39999ff")
      .style("box-shadow", "0 2px 12px rgba(0,0,0,0.5)")
      .style("font-size", "11px")
      .style("backdrop-filter", "blur(6px)");
  }

  tooltip
    .html(html)
    .style("left", event.clientX + 15 + "px")
    .style("top", event.clientY + 15 + "px")
    .style("opacity", 1);
}

function hideTooltip() {
  d3.select("#mapTooltip").style("opacity", 0).style("pointer-events", "none");
}
