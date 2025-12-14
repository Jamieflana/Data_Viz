const LEAGUE_COLORS = {
  GB1: "#005AB5",
  ES1: "#DC3220",
  L1: "#1B9E77",
  IT1: "#E6C300",
  FR1: "#7570B3",
};

function updateBarChart(data) {
  const container = d3.select("#barchart");
  container.selectAll("*").remove();

  const width = container.node().clientWidth;
  const height = container.node().clientHeight;

  const svg = container
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  // 1. Filter + Group Spending
  const grouped = d3.rollups(
    data.filter(
      (d) =>
        d.dir === "in" &&
        d.transfer_fee_amnt &&
        !isNaN(+d.transfer_fee_amnt) &&
        +d.transfer_fee_amnt > 0
    ),
    (v) => {
      const domestic = d3.sum(v, (d) =>
        d.team_country === d.counter_team_country ? +d.transfer_fee_amnt : 0
      );
      const international = d3.sum(v, (d) =>
        d.team_country !== d.counter_team_country ? +d.transfer_fee_amnt : 0
      );
      return { domestic, international };
    },
    (d) => d.league
  );

  // Sort by total spend desc
  grouped.sort(
    (a, b) =>
      b[1].domestic + b[1].international - (a[1].domestic + a[1].international)
  );

  const leagues = grouped.map((d) => d[0]);

  const stackedData = grouped.map((d) => ({
    league: d[0],
    domestic: d[1].domestic,
    international: d[1].international,
  }));

  const maxY = d3.max(stackedData, (d) => d.domestic + d.international);

  //2. SCALES

  const x = d3
    .scaleBand()
    .domain(leagues)
    .range([60, width - 20])
    .padding(0.3);

  const y = d3
    .scaleLinear()
    .domain([0, maxY * 1.1])
    .range([height - 40, 20])
    .nice();

  const color = d3
    .scaleOrdinal()
    .domain(["domestic", "international"])
    .range(["#9ecae1", "#3182bd"]); // light blue / dark blue

  //3. AXES

  svg
    .append("g")
    .attr("transform", `translate(0, ${height - 40})`)
    .call(d3.axisBottom(x));

  svg
    .append("g")
    .attr("transform", "translate(60,0)")
    .call(d3.axisLeft(y).ticks(6).tickFormat(formatMoney));

  //4. STACK LAYOUT

  const stack = d3.stack().keys(["domestic", "international"]);

  const series = stack(stackedData);

  //5. DRAW STACKED BARS

  svg
    .append("g")
    .selectAll("g")
    .data(series)
    .enter()
    .append("g")
    .selectAll("rect")
    .data((d) => d)
    .enter()
    .append("rect")
    .attr("x", (d) => x(d.data.league))
    .attr("width", x.bandwidth())
    .attr("y", y(0)) // start at baseline
    .attr("height", 0) // collapsed
    .attr("fill", (d) => {
      const base = LEAGUE_COLORS[d.data.league];
      const isDomestic = d[0] === 0; // lower stack
      return isDomestic ? base : d3.color(base).darker(1);
    })
   // .on("click", (e, d) => updateAllViewsForLeague(d.data.league))
    .on("mouseover", function (event, d) {
      const dom = d.data.domestic;
      const intl = d.data.international;

      d3.select(this).attr("stroke", "#000").attr("stroke-width", 2);

      showTooltip(
        event,
        `<strong>${d.data.league}</strong><br>
     Domestic: ${formatMoney(dom)}<br>
     International: ${formatMoney(intl)}<br>
     <strong>Total: ${formatMoney(dom + intl)}</strong>`
      );
    })
    .on("mouseout", function () {
      d3.select(this).attr("stroke", "none");

      hideTooltip();
    });

  svg
    .selectAll("rect")
    .transition()
    .duration(600)
    .ease(d3.easeCubicInOut)
    .attr("y", (d) => y(d[1]))
    .attr("height", (d) => y(d[0]) - y(d[1]));

  svg
    .append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -100)
    .attr("y", 10)
    .attr("text-anchor", "middle")
    .attr("fill", "#e4ecf5ff")
    .attr("font-size", "12px")
    .attr("font-weight", "600")
    .text("Transfer Spending (€)");

  svg
    .append("text")
    .attr("x", (width + 40) / 2)
    .attr("y", height - 5)
    .attr("text-anchor", "middle")
    .attr("fill", "#e4ecf5ff")
    .attr("font-size", "12px")
    .attr("font-weight", "600")
    .text("League");

  //6. LEGEND (Stacked vertically)

  const legend = svg.append("g").attr("transform", "translate(350, 0)");

  const legendItems = [
    { key: "domestic", label: "Domestic (league colour)" },
    { key: "international", label: "International (darker shade)" },
  ];

  legend
    .selectAll("g")
    .data(legendItems)
    .enter()
    .append("g")
    .attr("transform", (d, i) => `translate(0, ${i * 28})`) // Stack vertically with 28px spacing
    .each(function (d) {
      const g = d3.select(this);

      g.append("rect")
        .attr("width", 18)
        .attr("height", 18)
        .attr("rx", 3)
        .attr("fill", d.key === "domestic" ? "#cccccc" : "#888888");

      g.append("text")
        .attr("x", 24)
        .attr("y", 13)
        .attr("font-size", "12px")
        .attr("fill", "#e4ecf5ff")
        .text(d.label);
    });
}

//MONEY FORMATTER
function formatMoney(num) {
  if (num >= 1e9) return "€" + (num / 1e9).toFixed(2) + "B";
  if (num >= 1e6) return "€" + (num / 1e6).toFixed(0) + "M";
  return "€" + num.toLocaleString();
}

function adjustColor(col, amt) {
  return d3.color(col).darker(amt).formatHex();
}
