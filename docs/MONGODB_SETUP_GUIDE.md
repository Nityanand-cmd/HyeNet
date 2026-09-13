# MongoDB Atlas Setup Guide for HygieNet Cloud

This guide walks you through setting up a free, cloud-hosted MongoDB Atlas cluster for the HygieNet system.

---

## Step 1: Create a Free Atlas Account & Cluster
1. Go to [https://cloud.mongodb.com](https://cloud.mongodb.com) and sign in (or create a free account).
2. Click **Create** or **Build a Database**.
3. Choose the **M0 Free** tier (shared).
4. Select the cloud provider and region closest to you (e.g. AWS / Mumbai `ap-south-1`).
5. Name your cluster (e.g., `hygenetCluster`) and click **Create Deployment**.

---

## Step 2: Create Database User Credentials
1. In the left navigation menu, under **Security**, click **Database Access**.
2. Click the green **Add New Database User** button.
3. Authentication Method: Select **Password**.
4. Set a **Username** (e.g. `Nitya_20101` or `hygienet_admin`).
5. Set a secure **Password** (or click Autogenerate).
   > [!IMPORTANT]
   > Avoid special characters like `@`, `:`, `/`, or `%` inside your password, or ensure they are URL-encoded. Using letters and numbers (e.g., `1RofTIWhDAAuOAD5`) is recommended to avoid parsing issues.
6. Under **Database User Privileges**, select **Read and write to any database** (or Atlas admin).
7. Click **Add User**.

---

## Step 3: Allow Network Access (Whitelist 0.0.0.0/0)
> [!WARNING]
> Because Vercel serverless functions run on dynamic AWS IP addresses, you must allow connections from anywhere (`0.0.0.0/0`).

1. In the left menu, under **Security**, click **Network Access**.
2. Click **Add IP Address**.
3. Click the button **Allow Access From Anywhere** (which inputs `0.0.0.0/0`).
4. Set comment to `Vercel and local dev`.
5. Click **Confirm**. Wait ~1 minute until the status shows **Active**.

---

## Step 4: Get Your Connection String
1. In the left menu, under **Deployment**, click **Database**.
2. Click the **Connect** button next to your cluster.
3. Choose **Drivers** (Python).
4. Under "3. Add your connection string into your application code", copy the URI.
   It will look like:
   ```text
   mongodb+srv://<username>:<password>@hygenetcluster.kz6t0uo.mongodb.net/?retryWrites=true&w=majority
   ```
5. Replace `<password>` with your actual database user password.
6. Open `.env` in the HygieNet project and update `MONGODB_URI`:
   ```env
   MONGODB_URI="mongodb+srv://Nitya_20101:your_password@hygenetcluster.kz6t0uo.mongodb.net/?retryWrites=true&w=majority"
   ```

---

## Troubleshooting "Bad Auth / Authentication Failed"
If the server reports `bad auth : authentication failed`:
- Go to **Database Access** in MongoDB Atlas.
- Verify that the username matches exactly (usernames in MongoDB are case-sensitive).
- Click **Edit** next to the user -> **Edit Password** -> enter a new known password.
- Update the password in your `.env` file and save.
