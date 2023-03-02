import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from pyspark.sql import functions as F
from awsglue.dynamicframe import DynamicFrame

args = getResolvedOptions(sys.argv, ["JOB_NAME"])
sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args["JOB_NAME"], args)

# Script generated for node Data Catalog table
DataCatalogtable_node1 = glueContext.create_dynamic_frame.from_catalog(
    database="ddb_to_postgres_migration_db",
    table_name="new_encrypted_data",
    transformation_ctx="DataCatalogtable_node1",
)

# Convert binary column to hex string
df = DataCatalogtable_node1.toDF()
df2 = df.withColumn("emailverified_hex", F.base64(F.col("emailverified")).cast("string")) \
        .withColumn("label_hex", F.base64(F.col("label")).cast("string")) \
        .withColumn("token_hex", F.base64(F.col("token")).cast("string"))

# Script generated for node ApplyMapping
ApplyMapping_node2 = ApplyMapping.apply(
    frame=DynamicFrame.fromDF(df2.drop("emailverified", "label", "tokenid"), glueContext, "df2"),
    mappings=[
        ("id", "string", "id", "string"),
        ("token_hex", "string", "token", "binary"),
        ("emailverified_hex", "string", "emailverified", "binary"),
        ("label_hex", "string", "label", "binary"),
        ("lastusedtime", "long", "lastusedtime", "long"),
        ("lastupdatedby", "array", "lastupdatedby", "array"),
    ],
    transformation_ctx="ApplyMapping_node2",
)

# Script generated for node PostgreSQL table
PostgreSQLtable_node3 = glueContext.write_dynamic_frame.from_catalog(
    frame=ApplyMapping_node2,
    database="ddb_to_postgres_migration_db",
    table_name="postgres_public_encrypted_tokens",
    transformation_ctx="PostgreSQLtable_node3",
)

job.commit()
