let transfersRaw = [];
let CONFIG = {};
let currentSeason = 2021;
let startYear = 2009;
let endYear = 2021;
let currentLeague = "ALL";
let activeLeagueFilter = null;
let teamToLeague = {};
let yearMode = "single"; // "single" or "range"
let playing = false;
let animationInterval;
let activeLeague = null;
let animationEndYear = 2021; // Store target for animation

function buildTeamLeagueMap(data) {
  data.forEach((d) => {
    if (d.team_id && d.league) {
      teamToLeague[d.team_id] = d.league;
    }
  });
}

// Load both config and CSV first
Promise.all([
  d3.csv("data/transfers.csv"),
  fetch("config.json").then((r) => r.json()),
]).then(([csvData, configData]) => {
  transfersRaw = csvData;
  CONFIG = configData;

  buildTeamLeagueMap(csvData);

  updateAll();
});

//EVENT LISTENERS

// Single year slider
document.getElementById("seasonSlider").addEventListener("input", (e) => {
  currentSeason = +e.target.value;
  document.getElementById("seasonLabel").textContent = currentSeason;
  updateAll();
});

// Start year slider
document.getElementById("startYearSlider").addEventListener("input", (e) => {
  startYear = +e.target.value;

  // Ensure start <= end
  if (startYear > endYear) {
    endYear = startYear;
    document.getElementById("endYearSlider").value = endYear;
    document.getElementById("endYearLabel").textContent = endYear;
  }

  document.getElementById("startYearLabel").textContent = startYear;
  document.getElementById(
    "inlineRangeLabel"
  ).textContent = `${startYear}–${endYear}`;
  updateAll();
});

// End year slider
document.getElementById("endYearSlider").addEventListener("input", (e) => {
  endYear = +e.target.value;

  // Ensure start <= end
  if (endYear < startYear) {
    startYear = endYear;
    document.getElementById("startYearSlider").value = startYear;
    document.getElementById("startYearLabel").textContent = startYear;
  }

  document.getElementById("endYearLabel").textContent = endYear;
  document.getElementById(
    "inlineRangeLabel"
  ).textContent = `${startYear}–${endYear}`;
  updateAll();
});

document.getElementById("leagueSelect").addEventListener("change", (e) => {
  currentLeague = e.target.value;

  // Update activeLeague for scatter.js
  activeLeague = currentLeague === "ALL" ? null : currentLeague;

  updateAll();
});

document.getElementById("yearMode").addEventListener("change", (e) => {
  yearMode = e.target.value;

  // Toggle visibility of controls
  if (yearMode === "single") {
    document.getElementById("singleYearControls").style.display = "block";
    document.getElementById("rangeYearControls").style.display = "none";
  } else {
    document.getElementById("singleYearControls").style.display = "none";
    document.getElementById("rangeYearControls").style.display = "block";
    document.getElementById(
      "inlineRangeLabel"
    ).textContent = `${startYear}–${endYear}`;
  }

  updateAll();
});

document.getElementById("playBtn").addEventListener("click", () => {
  if (!playing) {
    playing = true;
    document.getElementById("playBtn").textContent = "⏸ Pause";
    startAnimation();
  } else {
    playing = false;
    document.getElementById("playBtn").textContent = "▶ Play";
    stopAnimation();
  }
});

//Animation function
function startAnimation() {
  if (yearMode === "single") {
  } else {
    animationEndYear = endYear; // Save where we want to end
  }

  let currentAnimationYear = yearMode === "single" ? currentSeason : startYear;

  animationInterval = setInterval(() => {
    if (yearMode === "single") {
      // Animate single year from current to 2021
      if (currentAnimationYear >= 2021) {
        stopAnimation();
        return;
      }
      currentAnimationYear++;
      currentSeason = currentAnimationYear;
      document.getElementById("seasonSlider").value = currentSeason;
      document.getElementById("seasonLabel").textContent = currentSeason;
    } else {
      // Animate range: expand END year toward animationEndYear
      if (currentAnimationYear >= animationEndYear) {
        stopAnimation();
        return;
      }

      // Increment animation year
      currentAnimationYear++;
      endYear = currentAnimationYear;

      document.getElementById("endYearSlider").value = endYear;
      document.getElementById("endYearLabel").textContent = endYear;
      document.getElementById(
        "inlineRangeLabel"
      ).textContent = `${startYear}–${endYear}`;
    }
    updateAll();
  }, 800); //speed
}

function stopAnimation() {
  clearInterval(animationInterval);
  playing = false;
  document.getElementById("playBtn").textContent = "▶ Play";
}

//FILTER LOGIC: Season + League + Range

function getFilteredData() {
  let data;

  if (yearMode === "single") {
    // Single year mode
    data = transfersRaw.filter((d) => +d.season === currentSeason);
  } else {
    // Range mode: include all transfers between start and end
    data = transfersRaw.filter((d) => {
      const season = +d.season;
      return season >= startYear && season <= endYear;
    });
  }

  // League filter
  if (currentLeague !== "ALL") {
    data = data.filter((d) => d.league === currentLeague);
  }

  if (activeLeagueFilter) {
    data = data.filter((d) => d.league === activeLeagueFilter);
  }

  return data;
}

//UPDATE ALL CHARTS

function updateAll() {
  const data = getFilteredData();
  console.log(`${yearMode} mode: ${data.length} transfers`);
  updateChoropleth(data);
  updateBarChart(data);
  updateScatter(data);
  updateSankey(data);
}

function updateAllViewsForLeague(leagueCode) {
  activeLeagueFilter = leagueCode;
  updateAll();
}
