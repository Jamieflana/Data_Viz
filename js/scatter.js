const scatterMargin = { top: 25, right: 30, bottom: 70, left: 75 };

let scatterSVG = null;
let scatterMainGroup = null;
let scatterWidth = 0;
let scatterHeight = 0;
let activeScatterLeagueFilter = null;

let scatterX = null;
let scatterY = null;

let activePositionFilter = null;

// Cache jitter offsets so animation does NOT recompute randomness each frame
const jitterCache = new Map();

//HELPERS

function jitter(range) {
  return (Math.random() - 0.5) * range;
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[idx];
}

function scatterKey(d) {
  return `${d.player_id || d.player_name || "p"}_${
    d.transfer_id || d.team_name || "t"
  }`;
}

function getJitterOffsets(d) {
  const key = scatterKey(d);
  if (!jitterCache.has(key)) {
    const dx = jitter(1);
    const dy = jitter(1);

    const posOffset =
      {
        GK: -3,
        DF: -1,
        MF: 1,
        FW: 3,
      }[getPositionGroup(d.player_pos)] || 0;

    jitterCache.set(key, { dx, dy, posOffset });
  }
  return jitterCache.get(key);
}

//STRATIFIED SAMPLING

function stratifiedSample(data, maxPoints) {
  if (data.length <= maxPoints) return data;

  const minFee = d3.min(data, (d) => d.transfer_fee);
  const maxFee = d3.max(data, (d) => d.transfer_fee);
  const logMin = Math.log10(minFee);
  const logMax = Math.log10(maxFee);

  const numFeeBins = 10;
  const binSize = (logMax - logMin) / numFeeBins;

  const bins = Array.from({ length: numFeeBins }, () => []);

  data.forEach((d) => {
    const logFee = Math.log10(d.transfer_fee);
    const binIndex = Math.min(
      Math.floor((logFee - logMin) / binSize),
      numFeeBins - 1
    );
    bins[binIndex].push(d);
  });

  const sampled = [];
  const samplesPerBin = Math.floor(maxPoints / numFeeBins);
  const remainder = maxPoints % numFeeBins;

  bins.forEach((bin, i) => {
    if (bin.length === 0) return;

    let binSamples = samplesPerBin + (i < remainder ? 1 : 0);
    binSamples = Math.min(binSamples, bin.length);

    const sortedBin = bin.slice().sort((a, b) => +a.season - +b.season);
    const step = bin.length / binSamples;

    for (let j = 0; j < binSamples; j++) {
      const index = Math.floor(j * step);
      sampled.push(sortedBin[index]);
    }
  });

  return d3.shuffle(sampled);
}

function updateScatter(data) {
  data = data.filter((d) => d.dir === "in");

  data.forEach((d) => {
    d.player_age = +d.player_age || null;
    d.transfer_fee = +d.transfer_fee_amnt || 0;
  });

  data = data.filter((d) => d.transfer_fee > 0 && d.player_age > 0);

  const MAX_POINTS = 2000;
  const originalCount = data.length;
  let isSampled = false;

  if (data.length > MAX_POINTS) {
    data = stratifiedSample(data, MAX_POINTS);
    isSampled = true;
  }

  const container = document.getElementById("scatter");
  const innerWidth =
    container.clientWidth - scatterMargin.left - scatterMargin.right;
  const innerHeight =
    container.clientHeight - scatterMargin.top - scatterMargin.bottom;

  scatterWidth = innerWidth;
  scatterHeight = innerHeight;

  // Create SVG / main group ONCE
  if (!scatterSVG) {
    d3.select("#scatter").select("svg").remove();

    scatterSVG = d3
      .select("#scatter")
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%");

    scatterMainGroup = scatterSVG
      .append("g")
      .attr(
        "transform",
        `translate(${scatterMargin.left},${scatterMargin.top})`
      );

    scatterMainGroup.append("g").attr("class", "x-axis axis");
    scatterMainGroup.append("g").attr("class", "y-axis axis");
    scatterMainGroup.append("g").attr("class", "axis-labels");
    scatterMainGroup.append("g").attr("class", "brush-bg");
    scatterMainGroup.append("g").attr("class", "legend");
    scatterMainGroup.append("g").attr("class", "position-legend");
    scatterMainGroup.append("text").attr("class", "scatter-sample");
  }

  if (!data.length) {
    scatterMainGroup.selectAll("path.dot").remove();
    scatterMainGroup.selectAll(".trend-line").remove();
    scatterMainGroup
      .select(".scatter-sample")
      .attr("x", 5)
      .attr("y", scatterHeight - 5)
      .style("font-size", "10px")
      .style("fill", "#666")
      .text(`n = 0 transfers`);
    return;
  }

  const fees = data.map((d) => d.transfer_fee);
  const p5 = percentile(fees, 5);
  const minBound = Math.max(d3.min(fees), p5);
  const maxBound = Math.min(d3.max(fees), 300000000);

  data = data.filter((d) => d.transfer_fee >= minBound);

  //SCALES

  scatterX = d3.scaleLinear().domain([15, 35]).range([0, scatterWidth]);

  scatterY = d3
    .scaleLog()
    .domain([minBound, maxBound])
    .range([scatterHeight, 0]);

  const color = d3
    .scaleOrdinal()
    .domain(["GB1", "ES1", "L1", "IT1", "FR1", "NL1", "POR"])
    .range([
      "#005AB5", // EPL
      "#DC3220", // La Liga
      "#1B9E77", // Bundesliga
      "#E6C300", // Serie A
      "#7570B3", // Ligue 1
    ]);

  const shapeScale = d3
    .scaleOrdinal()
    .domain(["GK", "DF", "MF", "FW"])
    .range([
      d3.symbolCross,
      d3.symbolSquare,
      d3.symbolCircle,
      d3.symbolDiamond,
    ]);

  const sizeScale = d3
    .scaleSqrt()
    .domain([minBound, maxBound])
    .range(data.length > 600 ? [25, 140] : [35, 350]);

  const sizeFactor = activeLeague ? 1.0 : 0.65;

  const leagueOpacityScale = {
    GB1: 1.0,
    ES1: 0.9,
    L1: 0.85,
    IT1: 0.8,
    FR1: 0.75,
    NL1: 0.65,
    POR: 0.6,
  };

  //GRADIENT COLOR FUNCTION FOR SINGLE LEAGUE VIEW

  const getFillColor = (d) => {
    if (!activeScatterLeagueFilter) {
      return color(d.league);
    }

    // Single league: use gradient from base color to lighter shade
    const baseColor = d3.color(color(d.league));
    const feeScale = d3
      .scaleLinear()
      .domain([minBound, maxBound])
      .range([0, 1]);

    const brightness = feeScale(d.transfer_fee);
    return d3.interpolateRgb(baseColor, baseColor.brighter(1.5))(brightness);
  };

  //PRECOMPUTE DISPLAY POSITIONS

  const baseJitter = activeLeague ? 14 : 22;

  data.forEach((d) => {
    const { dx, dy, posOffset } = getJitterOffsets(d);
    d._displayX = scatterX(d.player_age) + dx * baseJitter * 2.5;
    const yBase = scatterY(d.transfer_fee);
    const yJittered = yBase + dy * 4 + posOffset * 1.5;
    const padding = 4;
    d._displayY = Math.max(0, Math.min(scatterHeight - padding, yJittered)); // CLAMP Y TO THE BOTTOM OF X AXIS
  });

  //AXES

  scatterMainGroup
    .select(".x-axis")
    .attr("transform", `translate(0, ${scatterHeight})`)
    .call(d3.axisBottom(scatterX));

  const tickValues = [
    500000, 1e6, 2e6, 5e6, 1e7, 2e7, 5e7, 1e8, 2e8, 3e8,
  ].filter((v) => v >= minBound && v <= maxBound);

  scatterMainGroup.select(".y-axis").call(
    d3
      .axisLeft(scatterY)
      .tickValues(tickValues)
      .tickFormat((d) => "€" + d3.format(".2s")(d).replace("G", "B"))
  );

  //AXIS LABELS

  const axisLabels = scatterMainGroup.select(".axis-labels");
  axisLabels.selectAll("*").remove();

  // X-axis label
  axisLabels
    .append("text")
    .attr("x", scatterWidth / 2)
    .attr("y", scatterHeight + 40)
    .attr("text-anchor", "middle")
    .style("font-size", "13px")
    .style("font-weight", "600")
    .style("fill", "#e4ecf5ff")
    .text("Player Age (years)");

  // Y-axis label
  axisLabels
    .append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -scatterHeight / 2)
    .attr("y", -58)
    .attr("text-anchor", "middle")
    .style("font-size", "13px")
    .style("font-weight", "600")
    .style("fill", "#e4ecf5ff")
    .text("Transfer Fee (€, log scale)");

  //BRUSHING

  const brushLayer = scatterMainGroup.select(".brush-bg");
  brushLayer.selectAll("*").remove();

  brushLayer
    .append("rect")
    .attr("width", scatterWidth)
    .attr("height", scatterHeight)
    .attr("fill", "transparent");

  const brush = d3
    .brush()
    .extent([
      [0, 0],
      [scatterWidth, scatterHeight],
    ])
    .on("brush end", brushedScatterToChoropleth);

  brushLayer.call(brush);

  function brushedScatterToChoropleth(event) {
    if (!event.selection) {
      updateChoropleth(getFilteredData());
      return;
    }

    const [[x0, y0], [x1, y1]] = event.selection;

    const brushedData = data.filter(
      (d) =>
        d._displayX >= x0 &&
        d._displayX <= x1 &&
        d._displayY >= y0 &&
        d._displayY <= y1
    );

    updateChoropleth(brushedData);
  }

  //DRAW POINTS

  const points = scatterMainGroup
    .selectAll("path.dot")
    .data(
      data,
      (d) =>
        `${d.player_id || d.player_name}_${d.transfer_id || d.team_name}_${
          d.season
        }`
    );

  points.exit().transition().duration(400).attr("opacity", 0).remove();

  const entering = points
    .enter()
    .append("path")
    .attr("class", "dot")
    .attr("fill", getFillColor)
    .attr("opacity", 0)
    .attr(
      "d",
      d3
        .symbol()
        .type((d) => shapeScale(getPositionGroup(d.player_pos)))
        .size((d) => sizeScale(d.transfer_fee) * sizeFactor)
    )
    .attr("transform", (d) => `translate(${d._displayX}, ${d._displayY})`)
    .style("cursor", "pointer")
    .style("stroke", "#333")
    .style("stroke-width", 1.2)
    .style("stroke-opacity", 0.85)
    .on("mouseover", function (event, d) {
      d3.select(this)
        .attr("stroke", "#000")
        .attr("stroke-width", 2.5)
        .attr("opacity", 1)
        .raise();

      const dir = getDirection(d);
      showTooltip(
        event,
        `
        <strong>${d.player_name}</strong><br>
        Age: ${d.player_age}, Pos: ${d.player_pos}<br>
        Fee: €${d.transfer_fee.toLocaleString()}<br>
        League: ${d.league}<br>
        ${dir.from} → ${dir.to}<br>
        Season: ${d.season}
      `
      );
    })
    .on("mouseout", function () {
      d3.select(this)
        .attr("stroke", "#333")
        .attr("stroke-width", 1.2)
        .transition()
        .duration(150)
        .attr("opacity", (d) => {
          if (
            activeScatterLeagueFilter &&
            d.league !== activeScatterLeagueFilter
          )
            return 0.1;
          const base = activeLeague ? 1.0 : leagueOpacityScale[d.league] || 0.7;
          if (activePositionFilter)
            return getPositionGroup(d.player_pos) === activePositionFilter
              ? base
              : 0.1;
          return base;
        });
      hideTooltip();
    });

  entering
    .merge(points)
    .transition()
    .duration(500)
    .attr("fill", getFillColor)
    .attr("opacity", (d) => {
      if (activeScatterLeagueFilter && d.league !== activeScatterLeagueFilter)
        return 0.1;

      const base = activeLeague ? 1.0 : leagueOpacityScale[d.league] || 0.7;

      if (activePositionFilter)
        return getPositionGroup(d.player_pos) === activePositionFilter
          ? base
          : 0.1;

      return base;
    })
    .attr("transform", (d) => `translate(${d._displayX}, ${d._displayY})`)
    .attr(
      "d",
      d3
        .symbol()
        .type((d) => shapeScale(getPositionGroup(d.player_pos)))
        .size((d) => sizeScale(d.transfer_fee) * sizeFactor)
    );

  //LEAGUE LEGEND

  const legendGroup = scatterMainGroup.select(".legend");
  legendGroup.selectAll("*").remove();

  const legendX = scatterWidth / 2 - 275;
  const legendY = scatterHeight + 55;

  legendGroup.attr("transform", `translate(${legendX}, ${legendY})`);

  const leagueLegendData = [
    { code: "GB1", label: "EPL" },
    { code: "ES1", label: "La Liga" },
    { code: "L1", label: "Bundesliga" },
    { code: "IT1", label: "Serie A" },
    { code: "FR1", label: "Ligue 1" },
  ];

  leagueLegendData.forEach((lg, i) => {
    const g = legendGroup
      .append("g")
      .attr("transform", `translate(${i * 110}, 0)`)
      .style("cursor", "pointer")
      .on("click", () => {
        activeScatterLeagueFilter =
          activeScatterLeagueFilter === lg.code ? null : lg.code;
        updateScatter(getFilteredData());
      });

    g.append("circle")
      .attr("r", 5)
      .attr("fill", color(lg.code))
      .attr("stroke", "#000")
      .attr("stroke-width", activeScatterLeagueFilter === lg.code ? 2 : 0.5);

    g.append("text")
      .attr("x", 12)
      .attr("y", 4)
      .text(lg.label)
      .style("font-size", "11px")
      .style(
        "fill",
        activeScatterLeagueFilter === lg.code ? "#000" : "#e4ecf5ff"
      )
      .style(
        "font-weight",
        activeScatterLeagueFilter === lg.code ? "bold" : "normal"
      );
  });

  //POSITION LEGEND

  const posLegendGroup = scatterMainGroup.select(".position-legend");
  posLegendGroup.selectAll("*").remove();

  // Position: top-right, tighter inset
  const posLegendX = scatterWidth - 90;
  const posLegendY = 8;

  posLegendGroup.attr("transform", `translate(${posLegendX}, ${posLegendY})`);

  // Compact background panel
  posLegendGroup
    .append("rect")
    .attr("width", 100)
    .attr("height", 46)
    .attr("rx", 5)
    .attr("fill", "rgba(30, 32, 40, 0.85)")
    .attr("stroke", "#fff")
    .attr("opacity", 0.9)
    .style("pointer-events", "none");

  const posLegendData = [
    { code: "GK", label: "GK", shape: d3.symbolCross },
    { code: "DF", label: "DEF", shape: d3.symbolSquare },
    { code: "MF", label: "MID", shape: d3.symbolCircle },
    { code: "FW", label: "FWD", shape: d3.symbolDiamond },
  ];

  // Tighter grid geometry
  const colWidth = 52;
  const rowHeight = 20;
  const startX = 8;
  const startY = 15;

  posLegendData.forEach((pos, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);

    const g = posLegendGroup
      .append("g")
      .attr(
        "transform",
        `translate(${startX + col * colWidth}, ${startY + row * rowHeight})`
      )
      .style("cursor", "pointer")
      .on("click", () => {
        activePositionFilter =
          activePositionFilter === pos.code ? null : pos.code;
        updateScatter(getFilteredData());
      });

    g.append("path")
      .attr("d", d3.symbol().type(pos.shape).size(38))
      .style("fill", activePositionFilter === pos.code ? "#fff" : "#aaa")
      .attr("stroke", "#fff")
      .attr("stroke-width", activePositionFilter === pos.code ? 1.3 : 0.6);

    g.append("text")
      .attr("x", 10)
      .attr("y", 4)
      .text(pos.label)
      .style("font-size", "9.5px")
      .style("fill", activePositionFilter === pos.code ? "#fff" : "#aaa")
      .style(
        "font-weight",
        activePositionFilter === pos.code ? "600" : "normal"
      );
  });

  posLegendGroup.raise();

  scatterMainGroup
    .select(".scatter-sample")
    .attr("x", 5)
    .attr("y", scatterHeight - 8)
    .style("font-size", "10px")
    .style("fill", "#e4ecf5ff")
    .text(
      isSampled
        ? `n = ${data.length.toLocaleString()} shown (of ${originalCount.toLocaleString()} total)`
        : `n = ${data.length.toLocaleString()} transfers`
    );
}


//HELPER FUNCTIONS
function getPositionGroup(pos) {
  if (!pos) return "MF";
  pos = pos.toUpperCase();

  if (pos.startsWith("GK")) return "GK";
  if (
    pos.startsWith("CB") ||
    pos.startsWith("LB") ||
    pos.startsWith("RB") ||
    pos.startsWith("DF")
  )
    return "DF";
  if (pos.startsWith("M") || pos.startsWith("AM") || pos.startsWith("DM"))
    return "MF";
  if (
    pos.startsWith("CF") ||
    pos.startsWith("LW") ||
    pos.startsWith("RW") ||
    pos.startsWith("FW")
  )
    return "FW";

  return "MF";
}

function getDirection(d) {
  return d.dir === "in"
    ? {
        from: d.counter_team_country || "Unknown",
        to: d.team_name || "Unknown",
      }
    : { from: d.team_name || "Unknown", to: d.counter_team_name || "Unknown" };
}
