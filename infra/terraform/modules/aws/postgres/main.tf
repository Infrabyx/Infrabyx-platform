resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "this" {
  name        = "${var.name}-postgres"
  description = "PostgreSQL from the cluster only"
  vpc_id      = var.vpc_id
  ingress {
    description = "PostgreSQL"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidrs
  }
  tags = var.tags
}

# TLS only (verify-full in the apps), and the extensions of the IPB-01 whitelist load on demand.
resource "aws_db_parameter_group" "this" {
  name   = "${var.name}-pg18"
  family = "postgres18"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
  tags = var.tags
}

resource "aws_db_instance" "this" {
  identifier                          = var.name
  engine                              = "postgres"
  engine_version                      = "18"
  instance_class                      = var.instance_class
  allocated_storage                   = var.allocated_storage_gb
  storage_type                        = "gp3"
  storage_encrypted                   = true
  kms_key_id                          = var.kms_key_arn
  db_name                             = var.db_name
  username                            = "platform_admin"
  manage_master_user_password         = true
  master_user_secret_kms_key_id       = var.kms_key_arn
  iam_database_authentication_enabled = true
  multi_az                            = var.multi_az
  db_subnet_group_name                = aws_db_subnet_group.this.name
  vpc_security_group_ids              = [aws_security_group.this.id]
  parameter_group_name                = aws_db_parameter_group.this.name
  publicly_accessible                 = false
  backup_retention_period             = var.backup_retention_days
  deletion_protection                 = true
  skip_final_snapshot                 = false
  final_snapshot_identifier           = "${var.name}-final"
  copy_tags_to_snapshot               = true
  auto_minor_version_upgrade          = true
  performance_insights_enabled        = true
  performance_insights_kms_key_id     = var.kms_key_arn
  enabled_cloudwatch_logs_exports     = ["postgresql"]
  tags                                = var.tags
}

# The application role's URL is written by the database bootstrap, never by OpenTofu: the
# secret exists so that the chart's SecretProviderClass can name it (IPB-02-28).
resource "aws_secretsmanager_secret" "app_rw" {
  name       = "${var.secrets_path_prefix}/db/app_rw"
  kms_key_id = var.kms_key_arn
  tags       = var.tags
}
