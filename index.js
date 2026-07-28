const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('./supabaseClient');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'VitaCore AGRI backend is alive!' });
});

// Signup
app.post('/signup', async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: 'Signup successful', user: data.user });
});

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({
    message: 'Login successful',
    access_token: data.session.access_token,
    user: data.user,
  });
});

// Photo diagnosis
app.post('/diagnose', upload.single('photo'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No photo uploaded' });
    }

    const fileName = `${Date.now()}_${file.originalname}`;
    const { error: uploadError } = await supabase.storage
      .from('crop-photos')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
      });

    if (uploadError) {
      return res.status(500).json({ error: uploadError.message });
    }

    const { data: urlData } = supabase.storage
      .from('crop-photos')
      .getPublicUrl(fileName);
    const photoUrl = urlData.publicUrl;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const imageBase64 = file.buffer.toString('base64');

    const prompt = `You are an agricultural expert. Look at this crop photo and:
1. Identify the disease or issue (if any) affecting the plant.
2. Give organic treatment advice.
3. Give non-organic (chemical) treatment advice.
Respond ONLY in this JSON format, no extra text:
{
  "diagnosis": "...",
  "organic_advice": "...",
  "non_organic_advice": "..."
}`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: imageBase64,
          mimeType: file.mimetype,
        },
      },
    ]);

    let aiText = result.response.text();
    aiText = aiText.replace(/```json|```/g, '').trim();
    const aiResult = JSON.parse(aiText);

    // Save this diagnosis to the database
    const { error: insertError } = await supabase.from('diagnoses').insert({
      input_type: 'photo',
      photo_url: photoUrl,
      diagnosis: aiResult.diagnosis,
      organic_advice: aiResult.organic_advice,
      non_organic_advice: aiResult.non_organic_advice,
    });
    if (insertError) console.error('Insert error:', insertError);

    res.json({
      photoUrl,
      diagnosis: aiResult.diagnosis,
      organic_advice: aiResult.organic_advice,
      non_organic_advice: aiResult.non_organic_advice,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Diagnosis failed', details: err.message });
  }
});

// Text-based diagnosis
app.post('/diagnose-text', async (req, res) => {
  try {
    const { symptoms } = req.body;
    if (!symptoms) {
      return res.status(400).json({ error: 'No symptoms text provided' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `You are an agricultural expert. A farmer describes this crop problem:
"${symptoms}"

Based on this description:
1. Identify the likely disease or issue.
2. Give organic treatment advice.
3. Give non-organic (chemical) treatment advice.
Respond ONLY in this JSON format, no extra text:
{
  "diagnosis": "...",
  "organic_advice": "...",
  "non_organic_advice": "..."
}`;

    const result = await model.generateContent(prompt);
    let aiText = result.response.text();
    aiText = aiText.replace(/```json|```/g, '').trim();
    const aiResult = JSON.parse(aiText);

    // Save this diagnosis to the database
    const { error: insertError } = await supabase.from('diagnoses').insert({
      input_type: 'text',
      diagnosis: aiResult.diagnosis,
      organic_advice: aiResult.organic_advice,
      non_organic_advice: aiResult.non_organic_advice,
    });
    if (insertError) console.error('Insert error:', insertError);

    res.json({
      diagnosis: aiResult.diagnosis,
      organic_advice: aiResult.organic_advice,
      non_organic_advice: aiResult.non_organic_advice,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Diagnosis failed', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});