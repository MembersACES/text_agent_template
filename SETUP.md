# Knowledge Base Setup Guide

This guide walks you through setting up Google Cloud Platform (GCP) for the knowledge base feature that allows querying Google Docs.

## Prerequisites

- A Google Cloud Project
- A Google Doc you want to use as your knowledge base
- Access to Google Cloud Console

---

## Part 1: GCP Configuration

### Step 1: Create Service Account

A service account allows your application to access Google Drive on your behalf without user authentication.

1. Navigate to [IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Select your project (or create a new one if needed)
3. Click **"+ CREATE SERVICE ACCOUNT"**
4. Fill in the details:
   - **Service account name:** `knowledge-base-bot`
   - **Service account ID:** (auto-generated)
   - **Description:** "Service account for knowledge base document access"
5. Click **"CREATE AND CONTINUE"**
6. Grant the following roles:
   - **Storage Admin** (for Cloud Storage bucket access)
7. Click **"CONTINUE"** → **"DONE"**

### Step 2: Enable Required APIs

Enable the Google Cloud APIs needed for document access:

1. Go to [APIs & Services → Library](https://console.cloud.google.com/apis/library)
2. Search for and enable the following APIs:
   - **Google Drive API** - Click "ENABLE"
   - **Google Docs API** - Click "ENABLE"

### Step 3: Download Service Account Credentials

1. Return to [IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Click on your `knowledge-base-bot` service account
3. Go to the **"KEYS"** tab
4. Click **"ADD KEY"** → **"Create new key"**
5. Select **JSON** format
6. Click **"CREATE"**
7. The JSON file will download automatically - **keep this file secure!**

### Step 4: Create Cloud Storage Bucket

The bucket stores pre-computed document chunks and embeddings:

1. Go to [Cloud Storage → Buckets](https://console.cloud.google.com/storage)
2. Click **"CREATE BUCKET"**
3. Configure the bucket:
   - **Name:** `[your-project-id]-knowledge-base` (must be globally unique)
   - **Location type:** Region
   - **Location:** Choose the same region as your Cloud Run deployment
   - **Storage class:** Standard
   - **Access control:** Uniform
4. Click **"CREATE"**

### Step 5: Share Your Google Doc with Service Account ⚠️ CRITICAL

**This step is REQUIRED or you'll get "The caller does not have permission" errors!**

Give the service account access to your knowledge base document:

1. **Open your Google Doc** that you want to use as knowledge base
   - Direct URL format: `https://docs.google.com/document/d/YOUR_DOC_ID/edit`
   
2. **Click the "Share" button** (top right corner of the Google Doc)

3. **Find your service account email**:
   - Open the JSON file you downloaded in Step 3
   - Look for the `"client_email"` field
   - Copy the entire email address (looks like: `kb-text-agent-template@your-project.iam.gserviceaccount.com`)

4. **Add the service account to your document**:
   - In the Google Doc share dialog, paste the service account email into the "Add people and groups" field
   - Press Enter or click to add it

5. **Set the permission to "Viewer"** (select from the dropdown)

6. **Uncheck "Notify people"** (the service account doesn't need an email notification)

7. **Click "Share"** or "Send"

8. **Verify**: You should now see the service account email listed in the document's sharing settings

**✅ You're done when the service account email appears in your document's "Who has access" section**

### Step 6: Get Your Google Doc ID

Extract the document ID from your Google Doc URL:

```
https://docs.google.com/document/d/1ABC-XYZ-123456/edit
                                  ^^^^^^^^^^^^^^^^
                                  This is your Document ID
```

Copy the document ID - you'll need it for the environment configuration.

---

## Part 2: Environment Configuration

### Step 7: Configure Environment Variables

1. Open the `.env.local` file in your project (create it if it doesn't exist)
2. Add the following variables:

```bash
# Existing Gemini API Key
GEMINI_API_KEY=your_existing_key_here

# Google Cloud Service Account (from downloaded JSON file)
GCP_PROJECT_ID=your-project-id
GCP_CLIENT_EMAIL=knowledge-base-bot@your-project.iam.gserviceaccount.com
GCP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Cloud Storage Configuration
GCS_BUCKET_NAME=your-project-id-knowledge-base

# Knowledge Base Configuration
GOOGLE_DOC_ID=1ABC-XYZ-123456
```

### How to Fill in Service Account Credentials:

From your downloaded JSON file in Step 3, copy these values:

- **GCP_PROJECT_ID** → Copy from `project_id` field
- **GCP_CLIENT_EMAIL** → Copy from `client_email` field
- **GCP_PRIVATE_KEY** → Copy from `private_key` field (keep the quotes and \n characters)

**Important:** The `GCP_PRIVATE_KEY` should include the literal `\n` characters. Don't replace them with actual newlines.

### Step 8: Update .env.example

Add the new environment variable templates to `.env.example`:

```bash
GEMINI_API_KEY=your_gemini_api_key_here

# Google Cloud Service Account
GCP_PROJECT_ID=your-project-id
GCP_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GCP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nyour_private_key_here\n-----END PRIVATE KEY-----\n"

# Cloud Storage
GCS_BUCKET_NAME=your-bucket-name

# Knowledge Base
GOOGLE_DOC_ID=your_google_doc_id
```

---

## Part 3: Verification

### Step 9: Test Your Setup

Once the code is deployed, you can verify your setup:

1. **Index the document** (one-time):
   ```bash
   curl -X POST http://localhost:3000/api/knowledge-base/index
   ```

2. **Query the knowledge base**:
   ```bash
   curl -X POST http://localhost:3000/api/knowledge-base/query \
     -H "Content-Type: application/json" \
     -d '{"query": "What is this document about?"}'
   ```

---

## Troubleshooting

### "The caller does not have permission" or "Permission denied" errors

**This is the most common error!** It means the service account doesn't have access to your Google Doc.

**How to fix:**
1. Open your Google Doc in a browser
2. Click **"Share"** button (top right)
3. Check if the service account email is listed under "Who has access"
   - Look for: `your-service-account@your-project.iam.gserviceaccount.com`
4. If it's NOT there:
   - Add it following Step 5 above
   - Make sure to set permission to "Viewer"
   - Click "Share"
5. If it IS there:
   - Verify it has at least "Viewer" permission
   - Check if your organization has restrictions on sharing
   - Try removing and re-adding the service account
6. **Wait 30-60 seconds** after sharing, then retry the indexing

**To verify the service account email:**
- Open your service account JSON file
- Find `"client_email"` field
- This email MUST match exactly what you added to the Google Doc

### "Bucket not found" errors
- Verify the bucket name in `.env.local` matches the actual bucket name
- Ensure the service account has "Storage Admin" role
- Check that the bucket exists in the correct GCP project

### "API not enabled" errors
- Make sure both Google Drive API and Google Docs API are enabled
- Wait a few minutes after enabling APIs for changes to propagate

### "Invalid credentials" errors
- Verify the `GCP_PRIVATE_KEY` includes the literal `\n` characters
- Ensure all quotes and formatting from the JSON file are preserved
- Check that the `GCP_PROJECT_ID` matches your actual project

---

## Security Notes

⚠️ **Never commit `.env.local` to version control!**

- The service account JSON file contains sensitive credentials
- Always keep `.env.local` in `.gitignore`
- Use environment variables in production (Cloud Run secrets)
- Rotate keys regularly following security best practices

---

## Next Steps

After completing this setup:

1. Run `npm install` to install new dependencies
2. Start the development server: `npm run dev`
3. Index your document using the `/api/knowledge-base/index` endpoint
4. Start querying your knowledge base via chat!

For deployment to Cloud Run, ensure all environment variables are configured as secrets in your GCP project.
