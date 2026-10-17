.DEFAULT_GOAL := release

# Local registry settings are deliberately excluded from Git and Docker contexts.
-include .env.release

PYTHON ?= python3
REGISTRY ?= ghcr.io
IMAGE ?= $(REGISTRY)/your-github-username/bookmark-app
PLATFORMS ?= linux/amd64,linux/arm64
BUILDER ?= bookmark-app-multiarch-serial
BUILDKIT_CONFIG ?= buildkitd.toml

export TAG IMAGE REGISTRY PLATFORMS BUILDER BUILDKIT_CONFIG BUMP

.PHONY: release publish release-plan _publish login help

release publish:
	@$(PYTHON) tools/release.py

release-plan:
	@$(PYTHON) tools/release.py --dry-run

# Invoked by release.py inside an isolated snapshot of committed source.
_publish:
	@set -eu; \
	tag="$${TAG:-}"; \
	if [ -z "$$tag" ]; then \
		printf '错误: 内部发布步骤需要显式 TAG。请运行 make release。\n' >&2; exit 2; \
	fi; \
	case "$$tag" in \
		[A-Za-z0-9_]*) ;; \
		*) printf '错误: tag 必须以字母、数字或下划线开头。\n' >&2; exit 2 ;; \
	esac; \
	case "$$tag" in \
		*[!A-Za-z0-9_.-]*) printf '错误: tag 只能包含字母、数字、点、下划线和连字符。\n' >&2; exit 2 ;; \
	esac; \
	if [ "$${#tag}" -gt 128 ]; then \
		printf '错误: tag 不能超过 128 个字符。\n' >&2; \
		exit 2; \
	fi; \
	image="$$IMAGE:$$tag"; \
	if ! docker buildx inspect "$$BUILDER" >/dev/null 2>&1; then \
		printf '创建多平台构建器 %s\n' "$$BUILDER"; \
		docker buildx create \
			--name "$$BUILDER" \
			--driver docker-container \
			--buildkitd-config "$$BUILDKIT_CONFIG" >/dev/null; \
	fi; \
	docker buildx inspect "$$BUILDER" --bootstrap >/dev/null; \
	set --; \
	for platform in $$(printf '%s' "$$PLATFORMS" | tr ',' ' '); do \
		suffix=$${platform#linux/}; \
		suffix=$$(printf '%s' "$$suffix" | tr '/' '-'); \
		platform_image="$$image-$$suffix"; \
		printf '构建并推送 %s（平台: %s）\n' "$$platform_image" "$$platform"; \
		docker buildx build \
			--builder "$$BUILDER" \
			--platform "$$platform" \
			--provenance=false \
			--label "org.opencontainers.image.version=$$tag" \
			--tag "$$platform_image" \
			--push \
			.; \
		set -- "$$@" "$$platform_image"; \
	done; \
	if [ "$$#" -eq 0 ]; then \
		printf '错误: PLATFORMS 至少需要包含一个平台。\n' >&2; \
		exit 2; \
	fi; \
	printf '创建多平台镜像 %s\n' "$$image"; \
	docker buildx imagetools create --tag "$$image" --annotation "index:org.opencontainers.image.version=$$tag" "$$@"; \
	docker buildx imagetools inspect "$$image"

login:
	@docker login "$$REGISTRY"

help:
	@printf '%s\n' \
		'make release         自动递增补丁版本，推送版本镜像并更新 latest（make 默认入口）' \
		'make release-plan    只核对仓库和下一版本，不构建、不上传' \
		'make release BUMP=minor  递增次版本（也支持 major）' \
		'make release TAG=v1.0.0  显式指定更高的版本号' \
		'make login           登录镜像仓库' \
		'make release PLATFORMS=linux/amd64  只构建指定平台'
