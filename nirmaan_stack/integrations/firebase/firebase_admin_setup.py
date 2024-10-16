import firebase_admin
from firebase_admin import credentials
import io
import os
import base64
from dotenv import dotenv_values

# Use the absolute path to fcm.env
env_file_path = '/home/frappe/fcm.env'

# Step 1: Read the base64-encoded content from the file
try:
    with open(env_file_path, 'r') as file:
        base64_content = file.read().strip()
except FileNotFoundError:
    print(f"Error: The file '{env_file_path}' was not found.")
    exit(1)

# Step 2: Decode the base64 content into a UTF-8 string
decoded_env_content = base64.b64decode(base64_content).decode('utf-8')

# Step 3: Create a StringIO stream to simulate a file for dotenv_values
env_stream = io.StringIO(decoded_env_content)

# Step 4: Load the environment variables from the decoded content
env_vars = dotenv_values(stream=env_stream)

# Step 4: Manually load these environment variables into os.environ
os.environ.update(env_vars)




firebase_credentials = {
    "type": os.getenv('FIREBASE_TYPE'),
    "project_id": os.getenv('FIREBASE_PROJECT_ID'),
    "private_key_id": os.getenv('FIREBASE_PRIVATE_KEY_ID'),
    "private_key": os.getenv('FIREBASE_PRIVATE_KEY').replace("\\n", "\n"),
    "client_email": os.getenv('FIREBASE_CLIENT_EMAIL'),
    "client_id": os.getenv('FIREBASE_CLIENT_ID'),
    "auth_uri": os.getenv('FIREBASE_AUTH_URI'),
    "token_uri": os.getenv('FIREBASE_TOKEN_URI'),
    "auth_provider_x509_cert_url": os.getenv('FIREBASE_AUTH_PROVIDER_CERT_URL'),
    "client_x509_cert_url": os.getenv('FIREBASE_CLIENT_CERT_URL'),
    "universe_domain": os.getenv('UNIVERSE_DOMAIN')
}

def initializeFirebase():
    cred = credentials.Certificate(firebase_credentials)
    firebase_admin.initialize_app(cred)

    print("firebase admin initialized successfully!")