"""
BEFORE RUNNING:
---------------
1. If not already done, enable the Identity and Access Management (IAM) API
   and check the quota for your project at
   https://console.developers.google.com/apis/api/iam
2. This sample uses Application Default Credentials for authentication.
   If not already done, install the gcloud CLI from
   https://cloud.google.com/sdk and run
   `gcloud beta auth application-default login`.
   For more information, see
   https://developers.google.com/identity/protocols/application-default-credentials
3. Install the Python client library for Google APIs by running
   `pip install --upgrade google-api-python-client`
"""
import os
import json

from pprint import pprint

from googleapiclient import discovery
from oauth2client.client import GoogleCredentials

credentials = GoogleCredentials.get_application_default()

service = discovery.build('iam', 'v1', credentials=credentials)

# Required. The resource name of the project associated with the service
# accounts, such as `projects/my-project-123`.
name = 'projects/' + os.environ['project_id']  # TODO: Update placeholder value.

create_service_account_request_body = {
    "accountId": os.environ['project_id'],
    "serviceAccount": {
        "displayName": os.environ['service_account_name']
    }
}

request = service.projects().serviceAccounts().create(name=name, body=create_service_account_request_body)
response = request.execute()

# TODO: Change code below to process the `response` dict:
pprint('Success create service account: ' + os.environ['service_account_name'])
