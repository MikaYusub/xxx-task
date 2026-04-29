FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt requirements-real.txt ./
ARG REQUIREMENTS=requirements.txt
RUN pip install --no-cache-dir --timeout 120 --retries 5 -r "$REQUIREMENTS"
COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
