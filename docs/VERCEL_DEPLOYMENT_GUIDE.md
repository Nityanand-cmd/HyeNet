# Vercel Deployment Guide for HygieNet Cloud

This guide explains how to deploy the HygieNet serverless API and modern admin dashboard to Vercel in just a few minutes.

---

## Deployment Option A: Via GitHub (Recommended)

1. **Initialize Git & Push to GitHub**:
   Push your `HygieNet_Project` folder to a new private or public repository on [GitHub](https://github.com).
   *(Ensure `.env` is listed in your `.gitignore` so your database credentials are not publicly exposed).*

2. **Import into Vercel**:
   - Go to [https://vercel.com](https://vercel.com) and log in.
   - Click **Add New...** -> **Project**.
   - Select your GitHub repository from the list.

3. **Configure Project Settings**:
   - **Framework Preset**: Leave as *Other* (Vercel automatically detects `@vercel/python` from `vercel.json`).
   - Expand the **Environment Variables** section and add:
     - `MONGODB_URI`: Your Atlas connection string
     - `DEVICE_KEY`: `hygienet_r4_sec_2026_x89` (or your custom secret key)
     - `MONTHLY_DEFAULT_LIMIT`: `5`

4. **Deploy**:
   - Click **Deploy**.
   - Within 1–2 minutes, Vercel will provide your live URL (e.g., `https://hygienet-production.vercel.app`).

---

## Deployment Option B: Via Vercel CLI

1. If you have Node installed:
   ```bash
   npm install -g vercel
   ```
2. Navigate to your project folder in Command Prompt / Terminal and run:
   ```bash
   vercel
   ```
3. Follow the interactive prompts to link or create a project.
4. Set the environment variables in the Vercel dashboard:
   - Go to **Project Settings** -> **Environment Variables**.
   - Add `MONGODB_URI` and `DEVICE_KEY`.
5. Deploy to production:
   ```bash
   vercel --prod
   ```

---

## Verifying Your Live Deployment

1. **Dashboard Check**:
   Open `https://your-deployment.vercel.app` in any web browser. You should see the glassmorphic HygieNet Cloud Dashboard.

2. **API Health Check**:
   Open `https://your-deployment.vercel.app/api/health` in your browser. It should return:
   ```json
   {
     "status": "online",
     "service": "HygieNet Cloud API",
     "database": {
       "connected": true,
       "mode": "MongoDB Atlas"
     }
   }
   ```

3. **Configure the Arduino UNO R4 WiFi**:
   Open `HygieNet_R4_WiFi/config.h` and update:
   ```cpp
   #define SERVER_HOST "your-deployment.vercel.app"
   #define USE_SSL     true
   #define SERVER_PORT 443
   ```
