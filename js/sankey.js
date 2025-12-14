let sankeySVG = null;
let sankeyMainGroup = null;
let sankeyWidth = 0;
let sankeyHeight = 0;

const SANKEY_DURATION = 600;
const SANKEY_EASE = d3.easeCubicInOut;

// Big 5 leagues
const BIG5_LEAGUES = ["GB1", "ES1", "L1", "IT1", "FR1"];

// League full names for display
const LEAGUE_NAMES = {
  GB1: "Premier League",
  ES1: "La Liga",
  L1: "Bundesliga",
  IT1: "Serie A",
  FR1: "Ligue 1",
};

// League colors
const LEAGUE_COLOR = d3.scaleOrdinal().domain(BIG5_LEAGUES).range([
  "#005AB5", // GB1 - EPL (deep blue)
  "#DC3220", // ES1 - La Liga (red)
  "#1B9E77", // L1 - Bundesliga (teal)
  "#E6C300", // IT1 - Serie A (gold)
  "#984EA3", // FR1 - Ligue 1 (purple)
]);

// Region colors (distinct palette)
const REGION_COLOR = d3.scaleOrdinal().range([
  "#66c2a5", // Teal
  "#fc8d62", // Orange
  "#8da0cb", // Light blue
  "#e78ac3", // Pink
  "#a6d854", // Green
  "#ffd92f", // Yellow
  "#e5c494", // Tan
  "#b3b3b3", // Gray
]);

function updateHighlight(regionName) {
  if (typeof window.highlightRegionOnMap === "function") {
    window.highlightRegionOnMap(regionName);
  }
}

function resetUpdateHighlight() {
  if (typeof window.resetMapHighlight === "function") {
    window.resetMapHighlight();
  }
}

/**
 * Helper: stable id for a (region -> league) flow.
 * Used for joins + gradient ids.
 */
function linkKey(d) {
  const s = d.source?.name ?? d.regionName ?? d.source;
  const t = d.target?.name ?? d.leagueName ?? d.target;
  return `${s}→${t}`;
}

function displayNodeName(name) {
  return BIG5_LEAGUES.includes(name) ? LEAGUE_NAMES[name] : name;
}

function updateSankey(data) {
  //Filtering
  if (yearMode === "single") {
    data = data.filter((d) => +d.season === currentSeason);
  } else {
    data = data.filter((d) => +d.season <= currentSeason);
  }

  data = data.filter((d) => d.dir === "in");
  data = data.filter((d) => BIG5_LEAGUES.includes(d.league));

  if (activeLeague && BIG5_LEAGUES.includes(activeLeague)) {
    data = data.filter((d) => d.league === activeLeague);
  }

  if (!data.length) {
    d3.select("#sankey").html(
      "<p style='text-align:center;padding:100px;color:#999;'>No transfer data for this selection</p>"
    );
    return;
  }

  // BUILD FLOW MAP: region -> league

  const flowMap = new Map();

  data.forEach((d) => {
    const origin = d.counter_team_country || "Unknown";
    const region = COUNTRY_REGION_MAP[origin] || "Other";
    const key = region + "→" + d.league;
    flowMap.set(key, (flowMap.get(key) || 0) + 1);
  });

  //3. FILTER TO TOP REGIONS (reduce clutter)

  const MIN_TRANSFERS = 5;

  const regionTotals = new Map();
  flowMap.forEach((v, key) => {
    const region = key.split("→")[0];
    regionTotals.set(region, (regionTotals.get(region) || 0) + v);
  });

  // Keep top 12 regions + "Other" (if exists)
  const topRegions = Array.from(regionTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map((d) => d[0]);

  if (regionTotals.has("Other")) {
    topRegions.push("Other");
  }

  //4. BUILD NODES + LINKS

  let nodes = [];
  const nodeIndex = new Map();

  function addNode(name) {
    if (!nodeIndex.has(name)) {
      nodeIndex.set(name, nodes.length);
      nodes.push({ name });
    }
  }

  const links = [];

  flowMap.forEach((v, key) => {
    const [region, league] = key.split("→");
    if (!topRegions.includes(region) || v < MIN_TRANSFERS) return;

    addNode(region);
    addNode(league);

    links.push({
      source: nodeIndex.get(region),
      target: nodeIndex.get(league),
      value: v,
      regionName: region,
      leagueName: league,
    });
  });

  // Sort nodes: regions on left (by total), leagues on right (fixed order)
  const regionNodes = nodes.filter((n) => !BIG5_LEAGUES.includes(n.name));
  const leagueNodes = nodes.filter((n) => BIG5_LEAGUES.includes(n.name));

  regionNodes.sort(
    (a, b) => (regionTotals.get(b.name) || 0) - (regionTotals.get(a.name) || 0)
  );
  leagueNodes.sort(
    (a, b) => BIG5_LEAGUES.indexOf(a.name) - BIG5_LEAGUES.indexOf(b.name)
  );

  nodes = [...regionNodes, ...leagueNodes];

  // Rebuild index
  nodes.forEach((n, i) => nodeIndex.set(n.name, i));

  // Update link indices
  links.forEach((l) => {
    l.source = nodeIndex.get(l.regionName);
    l.target = nodeIndex.get(l.leagueName);
  });

  //5. SVG SETUP (ONCE) + PERSISTENT LAYERS

  const container = document.getElementById("sankey");
  sankeyWidth = container.clientWidth - 30;
  sankeyHeight = container.clientHeight;
  console.log("Sankey height", sankeyHeight);
  if (!sankeySVG) {
    d3.select("#sankey").select("svg").remove();

    sankeySVG = d3
      .select("#sankey")
      .append("svg")
      .attr("width", "100%")
      .attr("height", sankeyHeight)
      .style("overflow", "visible");

    sankeyMainGroup = sankeySVG
      .append("g")
      .attr("transform", "translate(89, 30)");

    // Create layers once
    sankeySVG.append("defs").attr("class", "sankey-defs");

    sankeyMainGroup.append("g").attr("class", "links");
    sankeyMainGroup.append("g").attr("class", "nodes");
    sankeyMainGroup.append("g").attr("class", "labels");
    sankeyMainGroup.append("g").attr("class", "meta");
  }

  //6. SANKEY LAYOUT

  const sankeyGen = d3
    .sankey()
    .nodeWidth(20)
    .nodePadding(12)
    .extent([
      [0, 0],
      [sankeyWidth - 145, sankeyHeight - 60],
    ]);

  const sankeyData = sankeyGen({
    nodes: nodes.map((n) => ({ ...n })),
    links: links.map((l) => ({ ...l })),
  });

  //7. GRADIENTS (KEYED JOIN, NO LEAKS)

  const defs = sankeySVG.select("defs.sankey-defs");

  const gradSel = defs
    .selectAll("linearGradient.sankey-grad")
    .data(sankeyData.links, (d) => linkKey(d));

  const gradEnter = gradSel
    .enter()
    .append("linearGradient")
    .attr("class", "sankey-grad")
    .attr("gradientUnits", "userSpaceOnUse")
    .attr("id", (d) => `grad-${linkKey(d).replace(/[^a-zA-Z0-9_-]/g, "_")}`);

  // Create stops on enter
  gradEnter.append("stop").attr("class", "stop0").attr("offset", "0%");
  gradEnter.append("stop").attr("class", "stop1").attr("offset", "100%");

  // Update gradients
  const gradMerged = gradEnter.merge(gradSel);

  gradMerged.attr("x1", (d) => d.source.x1).attr("x2", (d) => d.target.x0);

  gradMerged
    .select("stop.stop0")
    .attr("stop-color", (d) => REGION_COLOR(d.source.name))
    .attr("stop-opacity", 0.6);

  gradMerged
    .select("stop.stop1")
    .attr("stop-color", (d) => LEAGUE_COLOR(d.target.name))
    .attr("stop-opacity", 0.8);

  gradSel.exit().remove();

  // Attach id back to links for stroke usage
  sankeyData.links.forEach((link) => {
    link.gradientId = `grad-${linkKey(link).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  });

  //8. DRAW / UPDATE LINKS (ANIMATED)

  const linkGroup = sankeyMainGroup.select("g.links");

  const linkSel = linkGroup
    .selectAll("path.sankey-link")
    .data(sankeyData.links, (d) => linkKey(d));

  const linkEnter = linkSel
    .enter()
    .append("path")
    .attr("class", "sankey-link")
    .attr("fill", "none")
    .attr("opacity", 0)
    .style("cursor", "pointer")
    // initial draw
    .attr("d", d3.sankeyLinkHorizontal())
    .attr("stroke", (d) => `url(#${d.gradientId})`)
    .attr("stroke-width", (d) => Math.max(2, d.width));

  // Merge for update + transitions
  const linkMerged = linkEnter.merge(linkSel);

  linkMerged
    .transition()
    .duration(SANKEY_DURATION)
    .ease(SANKEY_EASE)
    .attr("d", d3.sankeyLinkHorizontal())
    .attr("stroke", (d) => `url(#${d.gradientId})`)
    .attr("stroke-width", (d) => Math.max(2, d.width))
    .attr("opacity", 0.5);

  linkSel.exit().transition().duration(350).attr("opacity", 0).remove();

  // Rebind interactions (safe to re-attach each update; handlers overwrite)
  linkMerged
    .on("mouseover", function (evt, d) {
      d3.select(this)
        .interrupt()
        .attr("opacity", 0.9)
        .attr("stroke-width", Math.max(3, d.width + 2));

      // Highlight connected nodes
      sankeyMainGroup
        .selectAll(".sankey-node rect")
        .filter((n) => n === d.source || n === d.target)
        .attr("stroke-width", 3)
        .attr("stroke", "#000");

      showTooltip(
        evt,
        `<strong>${d.source.name} → ${LEAGUE_NAMES[d.target.name]}</strong><br>
         ${d.value.toLocaleString()} transfers<br>
         ${((d.value / d.source.value) * 100).toFixed(1)}% of ${
          d.source.name
        }'s exports`
      );
    })
    .on("mouseout", function () {
      d3.select(this)
        .interrupt()
        .attr("opacity", 0.5)
        .attr("stroke-width", function (d) {
          return Math.max(2, d.width);
        });

      sankeyMainGroup
        .selectAll(".sankey-node rect")
        .attr("stroke-width", 1)
        .attr("stroke", "#333");

      hideTooltip();
    });

  //9. DRAW / UPDATE NODES (ANIMATED)

  const nodeGroup = sankeyMainGroup.select("g.nodes");

  const nodeSel = nodeGroup
    .selectAll("g.sankey-node")
    .data(sankeyData.nodes, (d) => d.name);

  const nodeEnter = nodeSel
    .enter()
    .append("g")
    .attr("class", "sankey-node")
    .style("cursor", "pointer")
    .attr("opacity", 0);

  nodeEnter.append("rect").attr("stroke", "#333").attr("stroke-width", 1);

  const nodeMerged = nodeEnter.merge(nodeSel);

  // Animate group position using transform (cleaner)
  nodeMerged
    .transition()
    .duration(SANKEY_DURATION)
    .ease(SANKEY_EASE)
    .attr("opacity", 1)
    .attr("transform", (d) => `translate(${d.x0},${d.y0})`);

  // Animate rect geometry
  nodeMerged
    .select("rect")
    .transition()
    .duration(SANKEY_DURATION)
    .ease(SANKEY_EASE)
    .attr("height", (d) => Math.max(1, d.y1 - d.y0))
    .attr("width", (d) => d.x1 - d.x0)
    .attr("fill", (d) =>
      BIG5_LEAGUES.includes(d.name)
        ? LEAGUE_COLOR(d.name)
        : REGION_COLOR(d.name)
    );

  nodeSel.exit().transition().duration(350).attr("opacity", 0).remove();

  // Node interactions (preserved)
  nodeMerged
    .on("mouseover", function (evt, d) {
      d3.select(this)
        .select("rect")
        .attr("stroke-width", 3)
        .attr("stroke", "#000");

      if (!BIG5_LEAGUES.includes(d.name)) {
        updateHighlight(d.name);
      }

      // Highlight connected links
      sankeyMainGroup
        .selectAll(".sankey-link")
        .filter((l) => l.source === d || l.target === d)
        .attr("opacity", 0.9)
        .attr("stroke-width", (l) => Math.max(3, l.width + 2));

      const displayName = displayNodeName(d.name);

      showTooltip(
        evt,
        `<strong>${displayName}</strong><br>
         Total transfers: ${d.value.toLocaleString()}`
      );
    })
    .on("mouseout", function (evt, d) {
      d3.select(this)
        .select("rect")
        .attr("stroke-width", 1)
        .attr("stroke", "#333");

      if (!BIG5_LEAGUES.includes(d.name)) {
        resetUpdateHighlight();
      }

      sankeyMainGroup
        .selectAll(".sankey-link")
        .attr("opacity", 0.5)
        .attr("stroke-width", (l) => Math.max(2, l.width));

      hideTooltip();
    });

  //10. NODE LABELS (ANIMATED)

  const labelGroup = sankeyMainGroup.select("g.labels");

  const labelSel = labelGroup
    .selectAll("text.sankey-node-label")
    .data(sankeyData.nodes, (d) => d.name);

  const labelEnter = labelSel
    .enter()
    .append("text")
    .attr("class", "sankey-node-label")
    .style("font-size", "8.5px")
    .style("font-weight", "600")
    .style("fill", "#e4ecf5ff")
    .style("pointer-events", "none")
    .attr("opacity", 0);

  const labelMerged = labelEnter.merge(labelSel);

  labelMerged.each(function (d) {
    const text = d3.select(this);
    text.selectAll("*").remove();

    const isLeague = BIG5_LEAGUES.includes(d.name);

    if (isLeague) {
      // Line 1: League name
      text
        .append("tspan")
        .attr("x", d.x1 + 8)
        .attr("dy", "-0.2em")
        .text(displayNodeName(d.name));

      // Line 2: Total transfers
      text
        .append("tspan")
        .attr("x", d.x1 + 8)
        .attr("dy", "1.2em")
        .style("font-size", "10px")
        .style("font-weight", "400")
        .style("fill", "#cfd8dc")
        .text(`${d.value.toLocaleString()} transfers`);
    } else {
      // Regions stay single-line
      text.text(`${d.name} (${d.value.toLocaleString()})`);
    }
  });

  labelMerged
    .transition()
    .duration(SANKEY_DURATION)
    .ease(SANKEY_EASE)
    .attr("opacity", 1)
    .attr("x", (d) => (BIG5_LEAGUES.includes(d.name) ? d.x1 + 8 : d.x0 - 8))
    .attr("y", (d) => (d.y0 + d.y1) / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", (d) =>
      BIG5_LEAGUES.includes(d.name) ? "start" : "end"
    );

  labelSel.exit().transition().duration(250).attr("opacity", 0).remove();

  //11. TITLE, METADATA, LEGEND (META LAYER)

  const metaGroup = sankeyMainGroup.select("g.meta");
  metaGroup.selectAll("*").remove();

  const yearLabel =
    yearMode === "single" ? `${currentSeason}` : `${startYear}–${endYear}`;

  console.log(yearLabel);

  // Title
  metaGroup
    .append("text")
    .attr("x", (sankeyWidth - 160) / 2)
    .attr("y", -8)
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .style("font-weight", "bold")
    .style("fill", "#26b5a2ff")
    .text(`Transfer Flows: Regions to Leagues (${yearLabel})`);

  metaGroup
    .append("text")
    .attr("x", 200)
    .attr("y", sankeyHeight - 50)
    .style("font-size", "10px")
    .style("fill", "#26b5a2ff")
    .text(
      `Total: ${data.length.toLocaleString()} transfers | Top ${
        regionNodes.length
      } regions shown`
    );

  const legendGroup = metaGroup
    .append("g")
    .attr("class", "legend")
    .attr("transform", `translate(${sankeyWidth - 180}, 10)`);

  legendGroup
    .append("text")
    .attr("x", 0)
    .attr("y", 0)
    .style("font-size", "11px")
    .style("font-weight", "bold")
    .style("fill", "#2c3e50");

  legendGroup
    .append("text")
    .attr("x", 55)
    .attr("y", 15)
    .attr("dy", "0.35em")
    .style("font-size", "10px")
    .style("fill", "#666");

  const arrow = defs.selectAll("marker#arrowhead").data([1]);
  arrow
    .enter()
    .append("marker")
    .attr("id", "arrowhead")
    .attr("markerWidth", 10)
    .attr("markerHeight", 10)
    .attr("refX", 5)
    .attr("refY", 3)
    .attr("orient", "auto")
    .append("polygon")
    .attr("points", "0 0, 10 3, 0 6")
    .attr("fill", "#666");
}
