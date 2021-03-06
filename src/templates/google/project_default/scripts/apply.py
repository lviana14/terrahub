"""
BEFORE RUNNING:
---------------
1. If not already done, enable the Cloud Resource Manager API
   and check the quota for your project at
   https://console.developers.google.com/apis/api/cloudresourcemanager
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

service = discovery.build('cloudresourcemanager', 'v1', credentials=credentials)

project_body = {
    'name': os.environ['project_name'],
    'project_id': os.environ['project_id']
}

if os.environ['organization_id']:
    project_body['parent'] = {
        'type': 'organization',
        'id': os.environ['organization_id']
    }

request = service.projects().create(body=project_body)
response = request.execute()

# TODO: Change code below to process the `response` dict:
pprint('Success create project: ' + os.environ['project_name'])
pprint('Project id is: ' + os.environ['project_id'])
