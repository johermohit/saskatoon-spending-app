# Saskatoon Spending Story: Mission & Philosophy

## 1. The 'Zero-Dollar' Philosophy
This project is built on the principle of maximum insight at zero cost. Instead of relying on expensive, paid Geocoding APIs (like Google Maps), we leverage the City of Saskatoon's Open Data portal. By using the local Parcel CSV as our spatial source of truth, we eliminate API costs and data privacy concerns associated with third-party vendors.

## 2. Data-Join Logic (Regex Matching)
Since the procurement dataset lacks formal coordinates, we use a custom Regex-based matching engine to bridge the gap:
- **Normalization**: Standardizing suffixes (Ave to Avenue, St to Street) and casing.
- **Pattern Extraction**: Identifying street names and house numbers within unstructured 'Description' fields.
- **Spatial Mapping**: Joining extracted addresses against the Parcel dataset's 'FullAddress' and 'StreetName' columns to retrieve Neighbourhoods and representative coordinates.

## 3. Vision for Transparency
The ultimate goal is to transform dry procurement logs into a '3D Spending Story'. By extruding contract amounts into a spatial heatmap, citizens and policymakers can visualize where the city's infrastructure budget is flowing in real-time, fostering a more transparent and data-literate community.
