import express from 'express';
import cors from 'cors';
import documentRoutes from './routes/document.routes';

export const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: 'http://localhost:5173', // SECURITY FIX: Prevent external unauthorized API calls
  methods: ['GET', 'POST']
}));
app.use(express.json());

// API Routes
app.use('/documents', documentRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);

    // Start the background worker alongside the API for local development
    require('./worker');
  });
}
