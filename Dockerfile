FROM python:3.11.3-slim

WORKDIR /usr/src/app

COPY ./requirements.txt ./

RUN python -m pip install --no-cache-dir -r requirements.txt

COPY ./rs-publish.py ./version.json ./cookie-banner-rules-list.json ./

CMD ["python", "./rs-publish.py"]
