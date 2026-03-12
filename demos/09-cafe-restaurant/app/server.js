const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3200;

// In-memory reservation store
const reservations = [];
// In-memory dishes store (keyed by date)
const dishesByDate = {};

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname, "public")));

// POST /api/dishes — admin sets dishes for a date
app.post("/api/dishes", (req, res) => {
  const { date, entree, plats } = req.body;

  if (!date || typeof date !== "string" || Number.isNaN(Date.parse(date))) {
    return res.status(422).json({ error: "A valid date is required" });
  }
  if (!entree || typeof entree !== "string" || entree.trim().length === 0) {
    return res.status(422).json({ error: "entree is required" });
  }
  if (!Array.isArray(plats) || plats.length !== 3) {
    return res.status(422).json({ error: "plats must be an array of exactly 3 items" });
  }
  const cleanedPlats = plats.map((plat) => (typeof plat === "string" ? plat.trim() : ""));
  if (cleanedPlats.some((plat) => plat.length === 0)) {
    return res.status(422).json({ error: "plats must be non-empty strings" });
  }

  const cleanedEntree = entree.trim();
  dishesByDate[date] = { entree: cleanedEntree, plats: cleanedPlats };

  res.status(201).json({ success: true, dishes: { date, entree: cleanedEntree, plats: cleanedPlats } });
});

// GET /api/dishes/:date — get dishes for a specific date
app.get("/api/dishes/:date", (req, res) => {
  const { date } = req.params;
  const dishes = dishesByDate[date];
  if (!dishes) {
    return res.json({ dishes: null });
  }
  return res.json({ dishes: { date, entree: dishes.entree, plats: dishes.plats } });
});

// GET /api/dishes — list all configured dishes
app.get("/api/dishes", (_req, res) => {
  res.json({ dishes: dishesByDate });
});

// POST /api/reservations — create a new reservation
app.post("/api/reservations", (req, res) => {
  const {
    fullName,
    phone,
    date,
    timeSlot,
    guests,
    specialRequests,
    formula,
    platSelections,
  } = req.body;

  // Validate required fields
  if (!fullName || typeof fullName !== "string" || fullName.trim().length < 2) {
    return res.status(422).json({ error: "fullName is required (min 2 characters)" });
  }
  if (!phone || typeof phone !== "string" || !/^[0-9+\-\s()]+$/.test(phone)) {
    return res.status(422).json({ error: "A valid phone number is required" });
  }
  if (!date || typeof date !== "string" || Number.isNaN(Date.parse(date))) {
    return res.status(422).json({ error: "A valid date is required" });
  }
  if (!timeSlot || typeof timeSlot !== "string") {
    return res.status(422).json({ error: "timeSlot is required" });
  }
  const guestCount = Number(guests);
  if (!Number.isFinite(guestCount) || guestCount < 1 || guestCount > 50) {
    return res.status(422).json({ error: "guests must be between 1 and 50" });
  }
  const dishesForDate = dishesByDate[date];
  const allowedFormulas = ["entree_plat", "entree_only", "plat_only"];
  let cleanedPlatSelections = {};

  // Only validate formula/plat when dishes are configured for this date
  if (dishesForDate) {
    if (!formula || typeof formula !== "string" || !allowedFormulas.includes(formula)) {
      return res.status(422).json({ error: "formula must be one of entree_plat, entree_only, plat_only" });
    }
    if (formula === "entree_plat" || formula === "plat_only") {
      if (!platSelections || typeof platSelections !== "object" || Array.isArray(platSelections)) {
        return res.status(422).json({ error: "platSelections must be an object of plat quantities" });
      }
      let totalAssigned = 0;
      for (const [platName, qty] of Object.entries(platSelections)) {
        if (!dishesForDate.plats.includes(platName)) {
          return res.status(422).json({ error: "platSelections contains an unknown plat" });
        }
        if (!Number.isInteger(qty) || qty <= 0) {
          return res.status(422).json({ error: "platSelections quantities must be positive integers" });
        }
        totalAssigned += qty;
      }
      if (totalAssigned > guestCount) {
        return res.status(422).json({ error: "Total plat quantities cannot exceed guests" });
      }
      cleanedPlatSelections = platSelections;
    }
  }

  const reservation = {
    id: reservations.length + 1,
    fullName: fullName.trim(),
    phone: phone.trim(),
    date,
    timeSlot,
    guests: guestCount,
    formula,
    platSelections: cleanedPlatSelections,
    specialRequests: typeof specialRequests === "string" ? specialRequests.trim() : "",
    bookedAt: new Date().toISOString(),
  };

  reservations.push(reservation);

  console.log(`[NEW RESERVATION] #${reservation.id} — ${reservation.fullName} on ${reservation.date} at ${reservation.timeSlot} (${reservation.guests} guests)`);

  res.status(201).json({ success: true, reservation });
});

// GET /api/reservations — list all reservations
app.get("/api/reservations", (_req, res) => {
  res.json({ reservations });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Cafe Reservations server running at http://localhost:${PORT}`);
  console.log(`  Customer form:    http://localhost:${PORT}/`);
  console.log(`  Admin dashboard:  http://localhost:${PORT}/admin.html`);
});
