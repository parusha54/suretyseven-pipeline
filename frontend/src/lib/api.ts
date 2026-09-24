import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL?.trim() || 'http://localhost:3000';

export const api = axios.create({ baseURL });
