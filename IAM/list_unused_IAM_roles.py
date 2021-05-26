import datetime as dt
import boto3

client = boto3.client('iam')

# print boto3 version for version compatibilty
print(f'Boto3 version: {boto3.__version__}\n')

# Get All roles
roles = client.list_roles()
# print(roles)
# print('\n\n')

# Get the date prior to 6 months from now in the same format
date_before_six_months = (dt.datetime.now() - dt.timedelta(days=180)).strftime('%Y-%m-%dT%H:%M:%SZ')
print(f'Date before 6 months from now: {date_before_six_months}')

print(f'\nThese are the IAM roles which have been unused for or more than 6 months:')

# Get the JobId per IAM ARN
# Use the JobID to get the last access details
for role in roles.get('Roles'):
    # print(role.get('Arn'))
    if role.get('Arn'):
        # Generate last Access data for each role
        job_details = client.generate_service_last_accessed_details(Arn=role.get('Arn'))

        data = client.get_service_last_accessed_details(JobId=job_details.get('JobId'))

        # Remove the entries without LastAuthenticated
        if data.get('ServicesLastAccessed'):
            data = [d for d in data.get('ServicesLastAccessed') if d.get('LastAuthenticated')]
            # print(data)

            # need to capture the latest Authenticated time
            latest_timestamp = ''

            # Get the latest authenticated time
            for dict_ in data:
                timestamp = dict_.get('LastAuthenticated').strftime('%Y-%m-%dT%H:%M:%SZ')

                if not latest_timestamp or latest_timestamp < timestamp:
                    latest_timestamp = timestamp

            if(date_before_six_months > latest_timestamp) and data:
                print(f'\tARN: {data[0].get("LastAuthenticatedEntity")}')
                print(f'\tLast Accessed Datetime: {data[0].get("LastAuthenticated")}')
                print()
