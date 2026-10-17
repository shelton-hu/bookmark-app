.DEFAULT_GOAL := publish

REGISTRY ?= ghcr.io
IMAGE ?= $(REGISTRY)/your-github-username/bookmark-app
PLATFORMS ?= linux/amd64,linux/arm64
BUILDER ?= bookmark-app-multiarch-serial
BUILDKIT_CONFIG ?= buildkitd.toml

export TAG IMAGE PLATFORMS BUILDER BUILDKIT_CONFIG

.PHONY: publish login help

publish:
	@set -eu; \
	tag="$${TAG:-}"; \
	if [ -z "$$tag" ]; then \
		printf '请输入镜像 tag（例如 v1.0.0）: '; \
		IFS= read -r tag; \
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
	docker buildx imagetools create --tag "$$image" "$$@"; \
	docker buildx imagetools inspect "$$image"

login:
	docker login $(REGISTRY)

help:
	@printf '%s\n' \
		'make                 交互输入 tag，构建并推送双架构镜像' \
		'make TAG=v1.0.0      使用指定 tag 构建并推送' \
		'make login           登录镜像仓库' \
		'make PLATFORMS=linux/amd64 TAG=v1.0.0  只构建指定平台'
