import express from "express";
import axios from "axios";
import cron from "node-cron";
import dotenv from "dotenv";
import qs from "qs"; // For form-urlencoded login

dotenv.config();

const app = express();
app.use(express.json());

// --- Shopify Setup ---
const shopify = axios.create({
  baseURL: `${process.env.SHOPIFY_STORE_URL}/admin/api/2024-07`,
  headers: {
    "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
    "Content-Type": "application/json",
  },
});

// --- XaitCPQ Setup ---
const XAIT_API_URL = process.env.XAIT_API_URL;

let isSyncInProgress = false;

// --- Function to Get XaitCPQ Token ---
async function getXaitToken() {
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    Referer: "https://repfitness-dev.xaitcpq.net/",
  };

  const body = qs.stringify({
    grant_type: "password",
    username: process.env.XAIT_USERNAME,
    password: process.env.XAIT_PASSWORD,
  });

  try {
    const res = await axios.post(`${XAIT_API_URL}/account/login`, body, { headers });
    console.log("✅ Logged in successfully!");
    return res.data.access_token;
  } catch (err) {
    console.error("❌ Login failed:", err.response?.data || err.message);
    throw err;
  }
}

// Function: Get Existing Part by SKU (via Data List API)
async function getPartBySku(sku, token) {
  const viewId = process.env.XAIT_PART_LIST_VIEW_ID;
  if (!viewId) {
    console.warn("⚠️ XAIT_PART_LIST_VIEW_ID env var is not set; cannot lookup part by SKU.");
    return null;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const params = {
    sortField: "PartNumber",
    sortDirection: 0,
    "filters[0]": "PartNumber",
    "operators[0]": 0, // equals
    "values[0]": sku,
    "groups[0]": 0,
  };

  try {
    const url = `${XAIT_API_URL}/data/list/part/${viewId}/1/25`;
    const res = await axios.get(url, {
      headers,
      params,
      paramsSerializer: {
        serialize: (p) => qs.stringify(p, { encodeValuesOnly: true }),
      },
    });
    const data = res.data;
    const items = Array.isArray(data?.Items)
      ? data.Items
      : Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data?.Data)
      ? data.Data
      : Array.isArray(data)
      ? data
      : [];

    const first = items[0];
    if (first) {
      console.log(`🔍 Found existing part by SKU: ${sku}`);
      return first;
    }

    // Fallback: try contains operator if equals returned nothing
    const res2 = await axios.get(url, {
      headers,
      params: {
        ...params,
        "operators[0]": 2, // contains
      },
      paramsSerializer: {
        serialize: (p) => qs.stringify(p, { encodeValuesOnly: true }),
      },
    });
    const data2 = res2.data;
    const items2 = Array.isArray(data2?.Items)
      ? data2.Items
      : Array.isArray(data2?.items)
      ? data2.items
      : Array.isArray(data2?.Data)
      ? data2.Data
      : Array.isArray(data2)
      ? data2
      : [];
    const first2 = items2.find((it) =>
      String(it?.PartNumber ?? it?.SKU ?? it?.Sku ?? it?.sku ?? "").trim().toUpperCase() ===
      String(sku).trim().toUpperCase()
    );
    if (first2) {
      console.log(`🔍 Found existing part by SKU (contains fallback): ${sku}`);
      return first2;
    }

    console.log(`ℹ️ No existing part found for ${sku}`);
    return null;
  } catch (err) {
    console.error(`⚠️ Failed to check existing part (${sku}) via Data List API:`, err.response?.data || err.message);
    return null;
  }
}

// Function to Add a Part
async function addPartToXait(part, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  try {
    await axios.post(`${XAIT_API_URL}/part/add`, part, { headers });
    console.log(`✅ Added part: ${part.PartNumber}`);
  } catch (err) {
    console.error(`❌ Failed to add part: ${part.PartNumber}`, err.response?.data || err.message);
  }
}

// Function to Update a Part
async function updatePartInXait(id, part, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  try {
    await axios.put(`${XAIT_API_URL}/part/${id}`, part, { headers });
    console.log(`🔄 Updated part: ${part.PartNumber}`);
  } catch (err) {
    console.error(`❌ Failed to update part: ${part.PartNumber}`, err.response?.data || err.message);
  }
}

// Main Sync Logic
async function syncProducts() {
  if (isSyncInProgress) {
    console.warn("⏳ Sync already in progress; skipping this invocation.");
    return;
  }
  isSyncInProgress = true;
  console.log("⏱️ Starting sync...");
  try {
    const token = await getXaitToken();

    const { data } = await shopify.get("/products.json?limit=250");
    const products = data.products;
    const processedSkus = new Set();

    for (const product of products) {
      for (const variant of product.variants) {
        const rawSku = variant.sku || `SKU-${variant.id}`;
        const sku = String(rawSku).trim();
        const normalizedSku = sku.toUpperCase();

        if (!sku) {
          console.warn(`⚠️ Variant ${variant.id} for product ${product.id} has no SKU; skipping.`);
          continue;
        }

        if (processedSkus.has(normalizedSku)) {
          console.log(`↩️ Skipping duplicate SKU in current run: ${sku}`);
          continue;
        }
        processedSkus.add(normalizedSku);

        const part = {
          PartNumber: sku,
          Name: product.title,
          Description: product.body_html || "",
          Active: true,
          Saleable: true,
        };

        const existingPart = await getPartBySku(sku, token);

        if (existingPart) {
          console.log(`ℹ️ Part exists, skipping add: ${sku}`);
          // If later you want to update, call updatePartInXait here
        } else {
          await addPartToXait(part, token);
        }
      }
    }

    console.log("✅ Sync complete");
  } catch (err) {
    console.error("❌ Sync process failed:", err.response?.data || err.message);
  } finally {
    isSyncInProgress = false;
  }
}

// Schedule (every 5 minutes)
// cron.schedule("0 * * * *", syncProducts);
cron.schedule("*/5 * * * *", syncProducts);



// Manual trigger endpoint
app.get("/sync-now", async (req, res) => {
  await syncProducts();
  res.send("✅ Manual sync complete!");
});

// Debug endpoint to check a single SKU without creating
app.get("/check-sku", async (req, res) => {
  try {
    const sku = String(req.query.sku || "").trim();
    if (!sku) return res.status(400).json({ error: "Missing ?sku= parameter" });
    const token = await getXaitToken();
    const part = await getPartBySku(sku, token);
    return res.json({ sku, found: !!part, part });
  } catch (err) {
    return res.status(500).json({ error: err.response?.data || err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
