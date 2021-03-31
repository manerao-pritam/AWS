let AWS = require('aws-sdk')

// four function name goes here
const functionName = 'my-function'
const region = 'eu-west-1'

// Lambda client to get the Lambda config
let lambda = new AWS.Lambda({ apiVersion: '2015-03-31', region: region })

// EC2 client to get vpc config/routes/subnet, etc.
let ec2 = new AWS.EC2({ region: region })

// All error messages
// let errors = []

// Magic Numbers
const HTTP = 80
const HTTPS = 443
const ALL_TRAFFIC = '-1'

// Get Lambda configuration for a Lamdba function by function name
let getLambdaConfigs = async (functionName) => {
    /* This operation retrieves a Lambda function's event source mapping */
    var params = { FunctionName: functionName }

    let lambdaConfigs = ''

    try {
        lambdaConfigs = await lambda.getFunctionConfiguration(params).promise()
    }
    catch (err) {
        // console.log(err, err.stack)
        return err
    }

    return lambdaConfigs
}

let getSubnetType = async (subnetId) => {
    let response = []
    // let subnetType = 'Public'
    var params = {
        Filters: [
            {
                Name: 'association.subnet-id',
                Values: [subnetId]
            }
        ]
    }

    try {
        response.push(await ec2.describeRouteTables(params).promise())
    }
    catch (err) {
        console.log(err, err.stack)
        return err
    }

    for (let route of response[0].RouteTables[0].Routes) {
        if (route.NatGatewayId)
            return 'Private'
    }

    return 'Public'
}

let getNatGwIds = async (subnetIds) => {
    let natGwIds = []
    let response = []

    var params = {
        Filters: [
            {
                Name: 'association.subnet-id',
                Values: subnetIds
            }
        ]
    }

    try {
        response.push(await ec2.describeRouteTables(params).promise())
    }
    catch (err) {
        console.log(err, err.stack)
        return err
    }

    for (let routeTableConfig of response) {
        for (let routeConfig of routeTableConfig.RouteTables) {
            for (let route of routeConfig.Routes) {
                if (route.DestinationCidrBlock === '0.0.0.0/0' && route.NatGatewayId)
                    natGwIds.push(route.NatGatewayId)
            }
        }
    }
    return natGwIds
}

let getNatSubnetIds = async (NatGwIds) => {
    let natConfigs = []
    // // deleted NAT: nat-0556eXXXXXXXX69d
    var params = { NatGatewayIds: NatGwIds }

    try {
        natConfigs.push(await ec2.describeNatGateways(params).promise())
    }
    catch (err) {
        console.log(err, err.stack)
        return err
    }

    let subnetIds = []
    subnetIds.push(natConfigs[0].NatGateways[0].SubnetId)
    return subnetIds
}

let isLambdaInPrivateSubnet = async (subnetIds) => {
    let response = []
    let subnetType = ''
    for (let subnetId of subnetIds) {
        subnetType = await getSubnetType(subnetId)
        if (subnetType === 'Public')
            response.push(subnetId)
    }
    if (response.length > 0)
        return response

    return true
}

let isLambdaSgOk = async (securityGroupIds) => {
    // console.log(securityGroupIds)
    let outboundTrafficAllowedForAll
    for (let securityGroupId of securityGroupIds) {

        // reset flag for each SG; if Lambda has multiple SGs
        outboundTrafficAllowedForAll = false

        var params = {
            GroupIds: [securityGroupId]
        }
        let sgResponse = await ec2.describeSecurityGroups(params).promise()
        // console.log(sgResponse.SecurityGroups[0])

        for (let securityGroup of sgResponse.SecurityGroups) {
            // console.log(securityGroup)
            for (let egress of securityGroup.IpPermissionsEgress) {

                let groupId = securityGroup.GroupId
                let groupName = securityGroup.GroupName

                // ALL Traffic
                if (egress.IpProtocol === ALL_TRAFFIC &&
                    egress.IpRanges[0].CidrIp === '0.0.0.0/0') {
                    console.log(`\t - ${groupId} (${groupName}) allows All outbound traffic`)
                    outboundTrafficAllowedForAll = true
                }
                // Outbound Traffic for HTTP/HTTPS
                else if ('FromPort' in egress)
                    if (egress.FromPort === HTTP && egress.IpRanges[0].CidrIp === '0.0.0.0/0')
                        console.log(`\t - ${groupId} (${groupName}) allows HTTP traffic only`)
                    else if (egress.FromPort === HTTPS && egress.IpRanges[0].CidrIp === '0.0.0.0/0')
                        console.log(`\t - ${groupId} (${groupName}) allows HTTPS traffic only`)

            }
        }
    }

    return outboundTrafficAllowedForAll
}

exports.handler = async (event) => {

    // Get lambda config
    let lambdaConfigs = await getLambdaConfigs(functionName)
    // console.log(lambdaConfigs)

    // Get VPC Configs from the lambda configs
    let vpcConfigs = lambdaConfigs.VpcConfig

    if ('undefined' === vpcConfigs.VpcId || "" === vpcConfigs.VpcId)
        return `Lambda '${functionName}' is not in a VPC`

    // Lamdba has been deployed in a VPC
    let checksCounter = 0

    // TODO 1: Check if the Lambda is inside a Private Subnet(s)
    console.log(`Check ${++checksCounter}: Is Lambda in a Private Subnet?`)
    let isLambdaSubnetOk = true
    let lambdaSubnetResponse = await isLambdaInPrivateSubnet(vpcConfigs.SubnetIds)
    if (lambdaSubnetResponse === true)
        console.log(`\t - Yes`)
    else {
        console.log(`\t - Lambda is associated with below ${lambdaSubnetResponse.length} Public Subnet(s)`)
        console.log(`\t - ${lambdaSubnetResponse}`)
        isLambdaSubnetOk = false
    }

    if (!isLambdaSubnetOk)
        console.log(`\nCheck ${checksCounter} failed! \n`)
    else
        console.log(`\nCheck ${checksCounter} OK! \n`)


    // TODO 2: Check if the Lambda SG allows outbound traffic
    console.log(`\nCheck ${++checksCounter}: Does Lambda SG allow outbound traffic?`)
    let lambdaSgOk = await isLambdaSgOk(vpcConfigs.SecurityGroupIds)
    if (!lambdaSgOk) {
        console.log('\t - Lamdba SG needs to allow ALL outbound traffic')
        console.log(`\nCheck ${checksCounter} failed! \n`)
    }
    else
        console.log(`\nCheck ${checksCounter} OK! \n`)



    // TODO 3: Check if NAT GW is inside a Public Subnet
    // Subnet check
    let isNatSubnetOk = true
    let NatGwIds = await getNatGwIds(vpcConfigs.SubnetIds)
    console.log(`\nCheck ${++checksCounter}: Is NATGW in a Public Subnet?`)
    if (NatGwIds.length > 0) {
        // console.log(NatGwIds)
        let natSubnetIds = await getNatSubnetIds(NatGwIds)
        // console.log(natSubnetIds)
        let natSubnetType = ''
        for (let subnetId of natSubnetIds) {
            natSubnetType = await getSubnetType(subnetId)

            if (natSubnetType === 'Private') {
                console.log(`\t - ${subnetId} is a Private Subnet`)
                isNatSubnetOk = false
            }
        }
    }
    else {
        console.log('\t - Lambda is not added in any Private Subnet')
        isNatSubnetOk = false
    }

    if (isNatSubnetOk) {
        console.log(`\t - Yes`)
        console.log(`\nCheck ${checksCounter} OK! \n`)
    }
    else
        console.log(`\nCheck ${checksCounter} failed! \n`)

    return `Lambda has internet access: ${isLambdaSubnetOk && lambdaSgOk && isNatSubnetOk}`
}


// Uncomment this if you wanna run it locally
// exports.handler()
//     .then(result => { console.log(result) })
//     .catch(error => console.log(error))
