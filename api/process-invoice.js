// api/process-invoice.js
// This goes in your Vercel project under /api/ folder

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { imageBase64 } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Your Anthropic API key (stored as environment variable)
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    // Remove data URL prefix if present
    const base64Data = imageBase64.split(',')[1] || imageBase64;

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: base64Data
              }
            },
            {
              type: 'text',
              text: `Extract data from this oilfield invoice/ticket. Return ONLY valid JSON:

{
  "vendor": "company name",
  "amount": number,
  "date": "YYYY-MM-DD",
  "description": "service description",
  "category": "one of: Trucking, Water Hauling, Water Disposal, Labour, Equipment Rental, Fuel, Chemicals, Maintenance, Supplies, Other"
}

Category mapping:
- Water truck, fluid hauling, water transport → "Water Hauling"
- Water disposal, SWD → "Water Disposal"
- Trucking, transportation, hauling (non-water) → "Trucking"
- Labour, wages, operator → "Labour"
- Equipment rental, rig rental → "Equipment Rental"
- Fuel, diesel, gas → "Fuel"
- Chemicals, treating → "Chemicals"
- Repairs, maintenance, service → "Maintenance"
- Supplies, parts, materials → "Supplies"

Use null if field cannot be determined. Be accurate with numbers.`
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Anthropic API error:', errorData);
      return res.status(response.status).json({ 
        error: errorData.error?.message || 'Failed to process invoice' 
      });
    }

    const data = await response.json();
    const text = data.content[0].text;
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Could not extract data from invoice' });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Map category to cost code
    const categoryToCostCode = {
      'Trucking': '8306',
      'Water Hauling': '8305-160',
      'Water Disposal': '8305-170',
      'Labour': '8301',
      'Equipment Rental': '8302',
      'Fuel': '8303',
      'Chemicals': '8307',
      'Maintenance': '8401',
      'Supplies': '8403'
    };

    const result = {
      vendor: parsed.vendor || 'Unknown Vendor',
      amount: parsed.amount || 0,
      date: parsed.date || new Date().toISOString().split('T')[0],
      description: parsed.description || '',
      costCode: categoryToCostCode[parsed.category] || 'OTHER',
      category: parsed.category
    };

    res.status(200).json(result);

  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to process invoice' 
    });
  }
}